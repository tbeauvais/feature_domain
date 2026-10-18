import type { ModelStore } from '@feature-domain/engine'
import { ApiModelStore } from './stores/apiModelStore'

let store: ModelStore | undefined

/** The model store the app uses: the Worker's API (`ApiModelStore`) unless tests replace it with `setModelStore`. */
export function modelStore(): ModelStore {
  store ??= new ApiModelStore()
  return store
}

export function setModelStore(next: ModelStore): void {
  store = next
}
