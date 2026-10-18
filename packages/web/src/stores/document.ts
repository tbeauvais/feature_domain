import {
  addFeature,
  defaultRegistry,
  editText as editTextIn,
  insertTextAfter,
  generate,
  migrate,
  moveFeature,
  removeFeature,
  matchingPreset,
  THEME_PRESETS,
  themeInputs,
  updateInputs,
  useThemeOnUnthemedPages,
  validateModel,
  ModelConflictError,
  ModelNotFoundError,
  type AppModel,
  type GenerateResult,
  type InputValue,
  type PlacementTarget,
  type RemoveResult,
  type TextLocation,
} from '@feature-domain/engine'
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { paletteTarget } from '../editor/targets'
import { modelStore } from '../services'
import { KEEPALIVE_MAX_BYTES } from './apiModelStore'
import { announceSaved } from './modelChannel'

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'error'
/**
 * `error`: the last save failed (the next edit tries again). `conflict`: someone else saved the model since it was
 * loaded, and `deleted`: someone deleted it; both hold every save until the user chooses what to do.
 */
export type SaveState = 'saved' | 'pending' | 'saving' | 'error' | 'conflict' | 'deleted'

/** Edits are saved this long after the last change. */
export const SAVE_DELAY_MS = 400
/** Consecutive edits of the same thing (typing in one field) within this window are one undo step. */
export const UNDO_COALESCE_MS = 1000
export const UNDO_LIMIT = 100

interface HistoryEntry {
  model: AppModel
  selectedId: string | null
}

/**
 * The model being viewed or edited, and its generated document (regenerated whenever the model changes). Models from
 * storage are validated before use, and a failed generation becomes `generateError`, so bad data shows an error
 * instead of a blank page. In editing mode the document includes placeholders, and every edit is saved shortly after.
 *
 * Saves go one at a time, each sent with the revision the last one returned, so a save is refused (a `conflict`)
 * only when someone else saved in between, never because of an earlier save from here.
 */
export const useDocumentStore = defineStore('document', () => {
  const modelId = ref<string | null>(null)
  const model = shallowRef<AppModel | null>(null)
  const status = ref<LoadStatus>('idle')
  const error = ref('')
  /** Editor mode: placeholders for features that produced nothing. The preview leaves this off. */
  const editing = ref(false)
  const selectedId = ref<string | null>(null)
  const saveState = ref<SaveState>('saved')
  const saveError = ref('')
  /** In a conflict: the revision someone else saved. */
  let theirRevision: number | undefined
  /** The revision of the model as stored, which the next save is made from. */
  let revision: number | undefined
  /** Bumped when another model loads or pending saves are dropped, so a save still in flight is ignored when it ends. */
  let session = 0
  const past = shallowRef<HistoryEntry[]>([])
  const future = shallowRef<HistoryEntry[]>([])
  const canUndo = computed(() => past.value.length > 0)
  const canRedo = computed(() => future.value.length > 0)

  const generation = computed<{ result: GenerateResult | null; error: string }>(() => {
    if (!model.value) return { result: null, error: '' }
    try {
      return { result: generate(model.value, defaultRegistry, { placeholders: editing.value }), error: '' }
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : String(e) }
    }
  })
  const result = computed(() => generation.value.result)
  const generateError = computed(() => generation.value.error)

  async function load(id: string): Promise<void> {
    await flush()
    session++
    revision = undefined
    modelId.value = id
    model.value = null
    selectedId.value = null
    status.value = 'loading'
    error.value = ''
    saveState.value = 'saved'
    past.value = []
    future.value = []
    lastKey = undefined
    try {
      const stored = await modelStore().get(id)
      if (modelId.value !== id) return
      if (stored === null) {
        status.value = 'missing'
        return
      }
      const loaded: unknown = stored.model
      const problems = validateModel(loaded)
      if (problems.length > 0) {
        status.value = 'error'
        error.value = `the model is not valid (${problems.slice(0, 3).join('; ')}${problems.length > 3 ? `; ${problems.length - 3} more` : ''})`
        return
      }
      // Features stored before their type was ported are migrated from their legacy settings now. The editor saves the
      // upgrade so it happens once; the preview only reads.
      const upgraded = migrate(loaded).model
      model.value = loaded as AppModel
      revision = stored.revision
      status.value = 'ready'
      if (upgraded !== loaded) {
        if (editing.value) setModel(upgraded)
        else model.value = upgraded
      }
    } catch (e) {
      if (modelId.value !== id) return
      status.value = 'error'
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  /**
   * Re-reads the current model without showing a loading state, e.g. when another tab or device saved it. Never
   * replaces local edits that aren't saved yet; invalid data leaves the current model in place, and a deleted model
   * shows as missing. Returns whether the model changed. In the editor, undo history ends there (undoing past someone
   * else's save would quietly take it back).
   */
  async function refresh(): Promise<boolean> {
    const id = modelId.value
    const at = session
    if (id === null || saveState.value !== 'saved' || status.value !== 'ready' || running) return false
    const stored = await modelStore().get(id)
    if (at !== session || modelId.value !== id || saveState.value !== 'saved' || running) return false
    if (stored === null) {
      model.value = null
      status.value = 'missing'
      return true
    }
    if (stored.revision === revision || validateModel(stored.model).length > 0) return false
    model.value = migrate(stored.model).model
    revision = stored.revision
    past.value = []
    future.value = []
    lastKey = undefined
    return true
  }

  // --- Saving -------------------------------------------------------------------------------------------------------

  let timer: ReturnType<typeof setTimeout> | undefined
  /** The save in flight, if any; `again` asks it to save the newest model once more when it ends. */
  let running: Promise<void> | undefined
  let again = false
  const held = () => saveState.value === 'conflict' || saveState.value === 'deleted'

  /** Saves the newest model now, after any save in flight. */
  function save(): Promise<void> {
    timer = undefined
    again = true
    running ??= run().finally(() => (running = undefined))
    return running
  }

  async function run(): Promise<void> {
    while (again) {
      again = false
      const id = modelId.value
      const snapshot = model.value
      const at = session
      if (id === null || !snapshot || held()) return
      saveState.value = 'saving'
      try {
        const saved = await modelStore().update(id, snapshot, revision)
        // Another model opened, or the edits were dropped, while this save was in flight: it no longer counts.
        if (at !== session) continue
        revision = saved
        announceSaved(id, saved)
        saveState.value = timer !== undefined ? 'pending' : again ? 'saving' : 'saved'
      } catch (e) {
        if (at !== session) continue
        if (e instanceof ModelConflictError) {
          theirRevision = e.revision
          saveState.value = 'conflict'
          saveError.value = 'someone else saved this model since you opened it'
        } else if (e instanceof ModelNotFoundError) {
          saveState.value = 'deleted'
          saveError.value = 'this model was deleted'
        } else {
          saveState.value = 'error'
          saveError.value = e instanceof Error ? e.message : String(e)
        }
        clearTimeout(timer)
        timer = undefined
        again = false
      }
    }
  }

  /** Drops edits waiting to be saved (and the result of one in flight), e.g. when the model is about to be deleted. */
  function discard(): void {
    clearTimeout(timer)
    timer = undefined
    again = false
    session++
    saveState.value = 'saved'
  }

  /**
   * Saves now if an edit is waiting to be saved, and waits for any save in flight. Resolves to false if the edits are
   * not stored (a failed save, a conflict or a deleted model).
   */
  async function flush(): Promise<boolean> {
    if (timer !== undefined) {
      clearTimeout(timer)
      await save()
    } else if (running) {
      await running
    }
    return saveState.value !== 'error' && !held()
  }

  /**
   * Whether closing the page now would lose edits: they could not be saved, or a save the page can't send as it
   * closes is still to go (one queued behind another, or too large for a keepalive request).
   */
  function unsavedOnLeave(): boolean {
    if (saveState.value === 'error' || held()) return true
    const waiting = timer !== undefined || again
    if (waiting && running) return true
    if (!waiting && !running) return false
    return model.value !== null && new TextEncoder().encode(JSON.stringify(model.value)).length >= KEEPALIVE_MAX_BYTES
  }

  /** After a failed save: tries again. */
  function retry(): Promise<void> {
    if (saveState.value !== 'error') return Promise.resolve()
    saveState.value = 'pending'
    return save()
  }

  /** In a conflict: drops the edits made here and shows the model as someone else saved it. */
  async function loadTheirs(): Promise<void> {
    if (modelId.value === null) return
    discard()
    await load(modelId.value)
  }

  /** In a conflict: saves the model as it is here over what someone else saved. */
  function keepMine(): Promise<void> {
    if (saveState.value !== 'conflict') return Promise.resolve()
    revision = theirRevision
    saveState.value = 'pending'
    return save()
  }

  /** When the model was deleted elsewhere: stores it as it is here as a new model, and returns that model's id. */
  async function saveCopy(): Promise<string> {
    const id = await modelStore().create(current())
    discard()
    return id
  }

  /** Sets the model and schedules a save, without touching undo history. Saving waits while a conflict is open. */
  function setModel(next: AppModel): void {
    model.value = next
    if (held()) return
    saveState.value = 'pending'
    clearTimeout(timer)
    timer = setTimeout(() => void save(), SAVE_DELAY_MS)
  }

  // --- Undo -----------------------------------------------------------------------------------------------------------

  let lastKey: string | undefined
  let lastAt = 0

  /** Every user edit goes through here: one undo step, unless it continues the previous edit of the same `key`. */
  function apply(next: AppModel, key?: string): void {
    if (next === model.value || !model.value) return
    const now = Date.now()
    const continuing = key !== undefined && key === lastKey && now - lastAt < UNDO_COALESCE_MS
    if (!continuing) past.value = [...past.value.slice(-(UNDO_LIMIT - 1)), { model: model.value, selectedId: selectedId.value }]
    future.value = []
    lastKey = key
    lastAt = now
    setModel(next)
  }

  function restore(entry: HistoryEntry): void {
    setModel(entry.model)
    selectedId.value = entry.selectedId !== null && entry.model.features.some((f) => f.id === entry.selectedId) ? entry.selectedId : null
    lastKey = undefined
  }

  function undo(): void {
    const entry = past.value.at(-1)
    if (!entry || !model.value) return
    past.value = past.value.slice(0, -1)
    future.value = [...future.value, { model: model.value, selectedId: selectedId.value }]
    restore(entry)
  }

  function redo(): void {
    const entry = future.value.at(-1)
    if (!entry || !model.value) return
    future.value = future.value.slice(0, -1)
    past.value = [...past.value, { model: model.value, selectedId: selectedId.value }]
    restore(entry)
  }

  /** Takes back the last edit as if it never happened (no redo), e.g. an entry added in place and then cancelled. */
  function retract(): void {
    const entry = past.value.at(-1)
    if (!entry || !model.value) return
    past.value = past.value.slice(0, -1)
    restore(entry)
  }

  // --- Edits (all pure engine operations; the store only keeps the result) ------------------------------------------

  function current(): AppModel {
    if (!model.value) throw new Error('No model is loaded')
    return model.value
  }

  function select(id: string | null): void {
    selectedId.value = id
  }

  /**
   * Adds a feature from the palette (see `paletteTarget`) and selects it. A new Theme is also used by every page that
   * has none, in the same undo step, so adding one restyles the page at once.
   */
  function add(featureType: string): string {
    const target = result.value ? paletteTarget(current(), result.value, selectedId.value, featureType) : undefined
    const added = addFeature(current(), featureType, target)
    apply(featureType === 'ThemeFeature' ? useThemeOnUnthemedPages(added.model, added.id) : added.model)
    selectedId.value = added.id
    return added.id
  }

  /** Adds a feature at a specific place (a palette drop) and selects it. */
  function addAt(featureType: string, target: PlacementTarget): string {
    const added = addFeature(current(), featureType, target, result.value ? { result: result.value } : {})
    apply(added.model)
    selectedId.value = added.id
    return added.id
  }

  function setInputs(id: string, changes: Record<string, InputValue | undefined>): void {
    apply(updateInputs(current(), id, changes), `inputs:${id}:${Object.keys(changes).sort().join(',')}`)
  }

  /**
   * Writes text edited on the page back into the input it came from, as one undo step. With `add`, also adds a list
   * entry or paragraph holding that text after it (Enter while editing one) and returns where the new one is. Text
   * emptied by the edit is removed instead, and nothing is added; an entry that was empty and still is stays, with the
   * new one after it.
   */
  function editText(location: TextLocation, text: string, add?: string): TextLocation | undefined {
    let next = editTextIn(current(), location, text)
    let added: TextLocation | undefined
    if (add !== undefined && location.kind !== 'text' && (text.trim() !== '' || next === current())) {
      const inserted = insertTextAfter(next, location, add)
      next = inserted.model
      added = inserted.location
    }
    apply(next)
    return added
  }

  function moveTo(id: string, target: PlacementTarget): void {
    apply(moveFeature(current(), id, target, result.value ? { result: result.value } : {}))
  }

  /** Removes a feature and everything inside it. Call `removeFeature` first to preview what will go. */
  function remove(id: string): RemoveResult {
    const removed = removeFeature(current(), id)
    apply(removed.model)
    if (selectedId.value !== null && removed.removed.includes(selectedId.value)) selectedId.value = null
    return removed
  }

  /**
   * Gives a Theme every setting of a built-in theme, as one undo step. A theme still named after a built-in theme takes
   * the new one's name; a name of its own is kept.
   */
  function applyThemePreset(id: string, presetId: string): void {
    const preset = THEME_PRESETS.find((p) => p.id === presetId)
    const theme = current().features.find((f) => f.id === id)
    if (!preset || theme?.feature !== 'ThemeFeature') return
    const name = typeof theme.inputs.name === 'string' ? theme.inputs.name.trim() : ''
    const renamed = name === '' || THEME_PRESETS.some((p) => p.name === name) ? preset.name : theme.inputs.name
    // Already that theme under the name it would get: nothing to change, so no undo step either.
    if (matchingPreset(theme.inputs)?.id === preset.id && renamed === theme.inputs.name) return
    apply(updateInputs(current(), id, { ...themeInputs(preset.params), name: renamed }))
  }

  /** Points every page without a working theme at this Theme. */
  function useThemeOnPages(themeId: string): void {
    apply(useThemeOnUnthemedPages(current(), themeId))
  }

  function rename(name: string): void {
    apply({ ...current(), name }, 'rename')
  }

  return {
    modelId,
    model,
    status,
    error,
    editing,
    selectedId,
    saveState,
    saveError,
    result,
    generateError,
    load,
    refresh,
    flush,
    discard,
    unsavedOnLeave,
    retry,
    loadTheirs,
    keepMine,
    saveCopy,
    select,
    add,
    addAt,
    setInputs,
    editText,
    moveTo,
    remove,
    applyThemePreset,
    useThemeOnPages,
    rename,
    canUndo,
    canRedo,
    undo,
    redo,
    retract,
  }
})
