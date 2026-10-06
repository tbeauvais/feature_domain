import { shallowRef } from 'vue'

export interface ConfirmRequest {
  title: string
  description: string
  confirmLabel: string
  destructive?: boolean
}

interface Pending extends ConfirmRequest {
  resolve: (confirmed: boolean) => void
}

/** The confirmation currently shown by <ConfirmHost>, if any. */
export const pendingConfirm = shallowRef<Pending | null>(null)

/**
 * Asks the user to confirm in an in-page dialog (rendered by <ConfirmHost>) instead of the browser's blocking
 * `confirm()`. Resolves to true when confirmed, false when cancelled or dismissed.
 */
export function confirmAction(request: ConfirmRequest): Promise<boolean> {
  pendingConfirm.value?.resolve(false)
  return new Promise((resolve) => {
    pendingConfirm.value = {
      ...request,
      resolve: (confirmed) => {
        pendingConfirm.value = null
        resolve(confirmed)
      },
    }
  })
}
