import { MemoryModelStore } from '@feature-domain/engine'
import { describe, expect, it } from 'vitest'
import { modelStore, setModelStore } from '../src/services'
import { ApiModelStore } from '../src/stores/apiModelStore'

describe('modelStore', () => {
  it("is the Worker's API unless a test replaces it", () => {
    expect(modelStore()).toBeInstanceOf(ApiModelStore)
    const memory = new MemoryModelStore()
    setModelStore(memory)
    expect(modelStore()).toBe(memory)
  })
})
