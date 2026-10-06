import {
  addFeature,
  defaultRegistry,
  generate,
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
      model.value = loaded as AppModel
      status.value = 'ready'
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
    model.value = loaded as AppModel
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

  /** Saves now if an edit is waiting to be saved. Resolves to false if that save failed (the edits are not stored). */
  async function flush(): Promise<boolean> {
    if (timer !== undefined) {
      clearTimeout(timer)
      await save()
    }
    return saveState.value !== 'error'
  }

  function apply(next: AppModel): void {
    if (next === model.value) return
    model.value = next
    saveState.value = 'pending'
    clearTimeout(timer)
    timer = setTimeout(() => void save(), SAVE_DELAY_MS)
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

  function setInputs(id: string, changes: Record<string, InputValue | undefined>): void {
    apply(updateInputs(current(), id, changes))
  }

  function moveTo(id: string, target: PlacementTarget): void {
    apply(moveFeature(current(), id, target))
  }

  /** Removes a feature and everything inside it. Call `removeFeature` first to preview what will go. */
  function remove(id: string): RemoveResult {
    const removed = removeFeature(current(), id)
    apply(removed.model)
    if (selectedId.value !== null && removed.removed.includes(selectedId.value)) selectedId.value = null
    return removed
  }

  function rename(name: string): void {
    apply({ ...current(), name })
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
    select,
    add,
    setInputs,
    moveTo,
    remove,
    rename,
  }
})
