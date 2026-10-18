/**
 * Tells this browser's other tabs (the preview, another editor) that a model was saved, so they show it at once
 * instead of at their next check. Other devices find out by checking (`useModelUpdates`).
 */
const CHANNEL = 'feature-domain:models'

export interface SavedMessage {
  id: string
  revision: number
}

const channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(CHANNEL)

export function announceSaved(id: string, revision: number): void {
  channel?.postMessage({ id, revision } satisfies SavedMessage)
}

/** Calls `listener` whenever another tab saves a model; returns a function that stops listening. */
export function onSaved(listener: (message: SavedMessage) => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {}
  // A channel of its own: a BroadcastChannel never receives its own messages, and this tab's saves need no refresh.
  const receiver = new BroadcastChannel(CHANNEL)
  receiver.onmessage = (event: MessageEvent<unknown>) => {
    const data = event.data as Partial<SavedMessage> | null
    if (typeof data?.id === 'string' && typeof data.revision === 'number') listener({ id: data.id, revision: data.revision })
  }
  return () => receiver.close()
}
