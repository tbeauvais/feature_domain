import type { AppModel } from '@feature-domain/engine'
import { defineStore } from 'pinia'
import { ref, shallowRef, watch } from 'vue'
import { publishing } from '../services'
import type { Publication, PublicationInfo, PublishRequest } from './apiModelStore'
import { useDocumentStore } from './document'

/** How long after the last edit the draft is compared with the published version again. */
export const CHANGED_DELAY_MS = 300

/**
 * The open model's app: where it is published, its newest version (what the draft is compared with) and the app's
 * rows, for the top bar and the Publish dialog. Publishing saves the draft first and publishes the revision saved.
 */
export const usePublicationStore = defineStore('publication', () => {
  const modelId = ref<string | null>(null)
  const info = shallowRef<PublicationInfo | null>(null)
  const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const error = ref('')
  /** Whether the draft differs from the newest version (false while it was never published). */
  const changed = ref(false)
  /** The newest version as compared (`canonical`), worked out once per load: models can be large. */
  let latestJson: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  function compare(): void {
    clearTimeout(timer)
    const draft = useDocumentStore().model
    changed.value = latestJson !== undefined && !!draft && canonical(draft) !== latestJson
  }
  // Edits come many a second (a resize drag regenerates every frame): compare once they pause, and only with a version.
  watch(
    () => useDocumentStore().model,
    () => {
      clearTimeout(timer)
      if (latestJson !== undefined) timer = setTimeout(compare, CHANGED_DELAY_MS)
    },
  )

  /** Bumped by each read, so only the newest one's answer counts (a slow earlier read never undoes a later one). */
  let reading = 0

  /** Reads the model's publication (again), and reserves its app's ids for new features (`reserveIds`). */
  async function load(id: string): Promise<void> {
    if (modelId.value !== id) {
      modelId.value = id
      info.value = null
      latestJson = undefined
      changed.value = false
    }
    const read = ++reading
    status.value = 'loading'
    error.value = ''
    try {
      const answer = await publishing().publication(id)
      if (read !== reading) return
      info.value = answer
      latestJson = answer?.latest ? canonical(answer.latest.model) : undefined
      status.value = 'ready'
      if (answer) useDocumentStore().reserveIds(id, [...(answer.latest?.model.features.map((f) => f.id) ?? []), ...Object.keys(answer.liveRows)])
      compare()
    } catch (e) {
      if (read !== reading) return
      status.value = 'error'
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  /** Saves the draft, publishes the revision saved, and reads the publication again. Throws the API's errors. */
  async function publish(request: PublishRequest): Promise<Publication> {
    const id = modelId.value
    if (id === null) throw new Error('No model is open')
    const document = useDocumentStore()
    if (!(await document.flush())) throw new Error("The model isn't saved. Resolve the save problem first.")
    const revision = document.savedRevision()
    if (revision === undefined) throw new Error("The model isn't saved yet")
    try {
      return await publishing().publish(id, revision, request)
    } finally {
      // Unless another model opened meanwhile, whose publication is read already.
      if (modelId.value === id) await load(id)
    }
  }

  /** Takes the app offline; its versions and rows stay. */
  async function unpublish(): Promise<void> {
    const id = modelId.value
    if (id === null) return
    try {
      await publishing().unpublish(id)
    } finally {
      // Unless another model opened meanwhile, whose publication is read already.
      if (modelId.value === id) await load(id)
    }
  }

  return { modelId, info, status, error, changed, load, publish, unpublish }
})

/**
 * A model as JSON with its keys sorted, without its id or `lastId` (which an add then undo raises), so the same model
 * always compares equal.
 */
function canonical(model: AppModel): string {
  const { id: _id, lastId: _lastId, ...rest } = model
  return JSON.stringify(rest, (_, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : value,
  )
}
