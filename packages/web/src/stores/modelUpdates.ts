import { onBeforeUnmount, onMounted } from 'vue'
import { onSaved } from './modelChannel'

/** How often an open model checks for saves made on other devices, while its tab is visible. */
export const CHECK_INTERVAL_MS = 10_000

/**
 * Keeps the open model current with saves made elsewhere: at once for this browser's other tabs (`announceSaved`),
 * when this tab is shown again, and every `CHECK_INTERVAL_MS` while it is visible (an unchanged model costs a 304).
 * `refresh` must leave unsaved local edits alone (the document store's does).
 */
export function useModelUpdates(modelId: () => string | null, refresh: () => Promise<unknown>): void {
  const check = () => void refresh().catch((error: unknown) => console.warn('Could not check the model for changes', error))
  let stop: (() => void) | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  const onVisibility = () => {
    if (document.visibilityState === 'visible') check()
  }
  onMounted(() => {
    stop = onSaved(({ id }) => {
      if (id === modelId()) check()
    })
    document.addEventListener('visibilitychange', onVisibility)
    timer = setInterval(() => {
      if (document.visibilityState === 'visible') check()
    }, CHECK_INTERVAL_MS)
  })
  onBeforeUnmount(() => {
    stop?.()
    document.removeEventListener('visibilitychange', onVisibility)
    clearInterval(timer)
  })
}
