import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { announceSaved } from '../src/stores/modelChannel'
import { CHECK_INTERVAL_MS, useModelUpdates } from '../src/stores/modelUpdates'

function watching(id: string) {
  const refresh = vi.fn(async () => true)
  const wrapper = mount(
    defineComponent({
      setup() {
        useModelUpdates(() => id, refresh)
        return () => h('div')
      },
    }),
  )
  return { refresh, wrapper }
}

const visibility = (state: DocumentVisibilityState) => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state)
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('useModelUpdates', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('checks for changes on an interval, only while the tab is visible', () => {
    vi.useFakeTimers()
    const { refresh, wrapper } = watching('m')
    vi.advanceTimersByTime(CHECK_INTERVAL_MS)
    expect(refresh).toHaveBeenCalledTimes(1)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    vi.advanceTimersByTime(CHECK_INTERVAL_MS * 3)
    expect(refresh).toHaveBeenCalledTimes(1)
    wrapper.unmount()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    vi.advanceTimersByTime(CHECK_INTERVAL_MS * 3)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('checks when the tab is shown again', () => {
    const { refresh, wrapper } = watching('m')
    visibility('hidden')
    expect(refresh).not.toHaveBeenCalled()
    visibility('visible')
    expect(refresh).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('checks at once when another tab saves this model, not others', async () => {
    const { refresh, wrapper } = watching('m')
    announceSaved('other', 2)
    announceSaved('m', 2)
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    wrapper.unmount()
    announceSaved('m', 3)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('logs a failed check instead of failing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const refresh = vi.fn(async () => {
      throw new Error('offline')
    })
    const wrapper = mount(defineComponent({ setup: () => (useModelUpdates(() => 'm', refresh), () => h('div')) }))
    visibility('visible')
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('Could not check the model for changes', expect.any(Error)))
    wrapper.unmount()
  })
})
