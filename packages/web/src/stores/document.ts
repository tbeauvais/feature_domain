import {
  addFeature,
  defaultRegistry,
  generate,
  migrate,
  moveFeature,
  removeFeature,
  updateInputs,
  validateModel,
  type AppModel,
  type GenerateResult,
  type InputValue,
  type PlacementTarget,
  type RemoveResult,
} from '@feature-domain/engine'
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { paletteTarget } from '../editor/targets'
import { modelStore } from '../services'

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'error'
export type SaveState = 'saved' | 'pending' | 'saving' | 'error'

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
      const loaded: unknown = await modelStore().get(id)
      if (modelId.value !== id) return
      if (loaded === null) {
        status.value = 'missing'
        return
      }
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
   * Re-reads the current model without showing a loading state, e.g. when another tab saved it. Never replaces local
   * edits that aren't saved yet; invalid or missing data leaves the current model in place. Returns whether it did.
   */
  async function refresh(): Promise<boolean> {
    const id = modelId.value
    if (id === null || saveState.value !== 'saved') return false
    const loaded: unknown = await modelStore().get(id)
    if (modelId.value !== id || saveState.value !== 'saved' || loaded === null || validateModel(loaded).length > 0) return false
    model.value = migrate(loaded).model
    status.value = 'ready'
    return true
  }

  // --- Saving -------------------------------------------------------------------------------------------------------

  let timer: ReturnType<typeof setTimeout> | undefined

  async function save(): Promise<void> {
    timer = undefined
    const id = modelId.value
    const snapshot = model.value
    if (id === null || !snapshot) return
    saveState.value = 'saving'
    try {
      await modelStore().update(id, snapshot)
      // A save that finishes after another model was opened must not change that model's state.
      if (modelId.value === id && model.value === snapshot) saveState.value = timer === undefined ? 'saved' : 'pending'
    } catch (e) {
      if (modelId.value !== id) return
      saveState.value = 'error'
      saveError.value = e instanceof Error ? e.message : String(e)
    }
  }

  /** Drops an edit waiting to be saved, e.g. when the model is about to be deleted. */
  function discard(): void {
    clearTimeout(timer)
    timer = undefined
    saveState.value = 'saved'
  }

  /** Saves now if an edit is waiting to be saved. Resolves to false if that save failed (the edits are not stored). */
  async function flush(): Promise<boolean> {
    if (timer !== undefined) {
      clearTimeout(timer)
      await save()
    }
    return saveState.value !== 'error'
  }

  /** Sets the model and schedules a save, without touching undo history. */
  function setModel(next: AppModel): void {
    model.value = next
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

  // --- Edits (all pure engine operations; the store only keeps the result) ------------------------------------------

  function current(): AppModel {
    if (!model.value) throw new Error('No model is loaded')
    return model.value
  }

  function select(id: string | null): void {
    selectedId.value = id
  }

  /** Adds a feature from the palette (see `paletteTarget`) and selects it. */
  function add(featureType: string): string {
    const target = result.value ? paletteTarget(current(), result.value, selectedId.value, featureType) : undefined
    const added = addFeature(current(), featureType, target)
    apply(added.model)
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
    select,
    add,
    addAt,
    setInputs,
    moveTo,
    remove,
    rename,
    canUndo,
    canRedo,
    undo,
    redo,
  }
})
