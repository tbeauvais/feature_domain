import type { ModelStore } from '@feature-domain/engine'
import { ApiModelStore, type Publishing } from './stores/apiModelStore'

let store: ModelStore | undefined

/** The model store the app uses: the Worker's API (`ApiModelStore`) unless tests replace it with `setModelStore`. */
export function modelStore(): ModelStore {
  store ??= new ApiModelStore()
  return store
}

export function setModelStore(next: ModelStore): void {
  store = next
}

let resetHome: (() => Promise<void>) | undefined

/** Puts the built-in home page back: the Worker's reset (`ApiModelStore.resetHome`) unless tests replace it with `setHomeReset`. */
export function homeReset(): () => Promise<void> {
  resetHome ??= () => new ApiModelStore().resetHome()
  return resetHome
}

export function setHomeReset(next: () => Promise<void>): void {
  resetHome = next
}

let publishingApi: Publishing | undefined

/** Publishing models as apps: the Worker's API (`ApiModelStore`) unless tests replace it with `setPublishing`. */
export function publishing(): Publishing {
  publishingApi ??= new ApiModelStore()
  return publishingApi
}

export function setPublishing(next: Publishing): void {
  publishingApi = next
}
