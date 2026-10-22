<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useRemeasure } from './useRemeasure'

// Outlines the selected feature, or the text being edited in place (`editing`). It lives outside the generated page
// (.fd-root), because the page is a hard CSS boundary where editor (Tailwind) styles have no effect; it is positioned
// from the element's bounding box.
const props = defineProps<{ container: HTMLElement | null; selectedId: string | null; editing?: HTMLElement | null; version: unknown }>()

const box = ref<{ top: number; left: number; width: number; height: number } | null>(null)

const { observe } = useRemeasure(() => props.container, measure)

function measure() {
  const container = props.container
  const el = !container
    ? null
    : props.editing
      ? props.editing
      : props.selectedId !== null
        ? container.querySelector(`[data-feature-id="${CSS.escape(props.selectedId)}"]`)
        : null
  observe(el)
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

watch(
  () => [props.container, props.selectedId, props.editing, props.version],
  () => void nextTick(measure),
  { immediate: true },
)
</script>

<template>
  <div
    v-if="box"
    class="pointer-events-none absolute rounded-sm ring-2 ring-offset-1"
    :class="editing ? 'ring-amber-500 ring-offset-2' : 'ring-sky-500'"
    data-testid="selection-overlay"
    :data-editing="editing ? '' : undefined"
    :style="{ top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px`, height: `${box.height}px` }"
  />
</template>
