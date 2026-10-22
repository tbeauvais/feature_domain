import { onBeforeUnmount, onMounted, watch } from 'vue'

/**
 * Calls `measure` whenever things on the canvas may have moved: the window resizing, images inside it finishing loading
 * (load events don't bubble, so it listens while capturing), or the canvas changing size. `observe(el)` also watches one
 * element's size (the selected feature's, whose content can arrive later: table rows, images).
 */
export function useRemeasure(container: () => HTMLElement | null, measure: () => void) {
  let observer: ResizeObserver | undefined
  let observed: Element | null = null
  const onLoad = () => measure()

  function observe(el: Element | null) {
    if (el === observed) return
    if (observed) observer?.unobserve(observed)
    if (el) observer?.observe(el)
    observed = el
  }

  onMounted(() => {
    window.addEventListener('resize', measure)
    watch(
      container,
      (el, old) => {
        old?.removeEventListener('load', onLoad, true)
        el?.addEventListener('load', onLoad, true)
      },
      { immediate: true },
    )
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure)
      watch(
        container,
        (el) => {
          observer?.disconnect()
          observed = null
          if (el) observer?.observe(el)
        },
        { immediate: true },
      )
    }
  })
  onBeforeUnmount(() => {
    window.removeEventListener('resize', measure)
    container()?.removeEventListener('load', onLoad, true)
    observer?.disconnect()
  })

  return { observe }
}
