/**
 * Tells this browser's other tabs (the preview, another editor) that a model was saved, so they show it at once
 * instead of at their next check. Other devices find out by checking (`useModelUpdates`).
 */
const CHANNEL = 'feature-domain:models'

/**
 * This tab. A BroadcastChannel skips only the object that posted, and every other channel object in this tab hears the
 * message too, so messages say which tab sent them and a tab ignores its own (its saves need no refresh).
 */
export const TAB_ID = typeof crypto === 'undefined' ? String(Math.random()) : crypto.randomUUID()

export interface SavedMessage {
  id: string
  revision: number
  /** The tab that saved. */
  tab: string
}

const channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(CHANNEL)

export function announceSaved(id: string, revision: number): void {
  channel?.postMessage({ id, revision, tab: TAB_ID } satisfies SavedMessage)
}

/** Calls `listener` whenever another tab saves a model; returns a function that stops listening. */
export function onSaved(listener: (message: SavedMessage) => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {}
  const receiver = new BroadcastChannel(CHANNEL)
  receiver.onmessage = (event: MessageEvent<unknown>) => {
    const data = event.data as Partial<SavedMessage> | null
    if (typeof data?.id !== 'string' || typeof data.revision !== 'number' || typeof data.tab !== 'string' || data.tab === TAB_ID) return
    listener({ id: data.id, revision: data.revision, tab: data.tab })
  }
  return () => receiver.close()
}
