<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

// Outlines the selected feature. It lives outside the generated page (.fd-root), because the page is a hard CSS
// boundary where editor (Tailwind) styles have no effect; it is positioned from the element's bounding box.
const props = defineProps<{ container: HTMLElement | null; selectedId: string | null; version: unknown }>()

const box = ref<{ top: number; left: number; width: number; height: number } | null>(null)

let observer: ResizeObserver | undefined
let observed: Element | null = null

function measure() {
  const container = props.container
  const el = container && props.selectedId !== null ? container.querySelector(`[data-feature-id="${CSS.escape(props.selectedId)}"]`) : null
  // Also watch the selected element itself: its size changes when content arrives later (table rows, images).
  if (el !== observed) {
    if (observed) observer?.unobserve(observed)
    if (el) observer?.observe(el)
    observed = el
  }
  if (!container || !el) {
    box.value = null
    return
  }
  const outer = container.getBoundingClientRect()
  const inner = el.getBoundingClientRect()
  // Absolute positions are relative to the container's padding box, inside its border.
  box.value = {
    top: inner.top - outer.top - container.clientTop + container.scrollTop,
    left: inner.left - outer.left - container.clientLeft + container.scrollLeft,
    width: inner.width,
    height: inner.height,
  }
}

watch(() => [props.container, props.selectedId, props.version], () => void nextTick(measure), { immediate: true })

// Images finishing loading inside the page (load events don't bubble, so listen while capturing).
const onLoad = () => measure()
onMounted(() => {
  window.addEventListener('resize', measure)
  watch(
    () => props.container,
    (el, old) => {
      old?.removeEventListener('load', onLoad, true)
      el?.addEventListener('load', onLoad, true)
    },
    { immediate: true },
  )
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(measure)
    watch(
      () => props.container,
      (el) => {
        observer?.disconnect()
        if (el) observer?.observe(el)
      },
      { immediate: true },
    )
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', measure)
  props.container?.removeEventListener('load', onLoad, true)
  observer?.disconnect()
})
</script>

<template>
  <div
    v-if="box"
    class="pointer-events-none absolute rounded-sm ring-2 ring-sky-500 ring-offset-1"
    data-testid="selection-overlay"
    :style="{ top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px`, height: `${box.height}px` }"
  />
</template>
