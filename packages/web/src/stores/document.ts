import { generate, validateModel, type AppModel, type GenerateResult } from '@feature-domain/engine'
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { modelStore } from '../services'

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'error'

/**
 * The model being viewed, and its generated document (regenerated whenever the model changes). Models from storage
 * are validated before use, and a failed generation becomes `generateError`, so bad data shows an error instead of a
 * blank page.
 */
export const useDocumentStore = defineStore('document', () => {
  const modelId = ref<string | null>(null)
  const model = shallowRef<AppModel | null>(null)
  const status = ref<LoadStatus>('idle')
  const error = ref('')

  const generation = computed<{ result: GenerateResult | null; error: string }>(() => {
    if (!model.value) return { result: null, error: '' }
    try {
      return { result: generate(model.value), error: '' }
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : String(e) }
    }
  })
  const result = computed(() => generation.value.result)
  const generateError = computed(() => generation.value.error)

  async function load(id: string): Promise<void> {
    modelId.value = id
    model.value = null
    status.value = 'loading'
    error.value = ''
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

  return { modelId, model, status, error, result, generateError, load }
})
