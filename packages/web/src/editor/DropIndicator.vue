<script setup lang="ts">
import { computed } from 'vue'
import { dragState } from './dndState'

// Shows where a drop on the page would go: a line before/after a feature, or an outline around the slot or feature
// it would go into; red with the reason when the drop is not allowed. Like the selection outline, it lives outside
// the generated page and is positioned from bounding boxes.
const props = defineProps<{ container: HTMLElement | null }>()

const indicator = computed(() => {
  const state = dragState.value
  const container = props.container
  if (!state || state.surface !== 'canvas' || !state.element || !state.zone || !state.evaluation || !container) return null
  if (state.evaluation.allowed && state.evaluation.noop) return null
  const outer = container.getBoundingClientRect()
  const inner = state.element.getBoundingClientRect()
  const top = inner.top - outer.top - container.clientTop + container.scrollTop
  const left = inner.left - outer.left - container.clientLeft + container.scrollLeft
  const allowed = state.evaluation.allowed
  const reason = state.evaluation.allowed ? '' : state.evaluation.reason
  if (state.zone.kind === 'feature' && state.zone.operation !== 'combine') {
    const y = state.zone.operation === 'reorder-before' ? top : top + inner.height
    return { kind: 'line' as const, style: { top: `${y - 1}px`, left: `${left}px`, width: `${inner.width}px` }, allowed, reason }
  }
  return { kind: 'box' as const, style: { top: `${top}px`, left: `${left}px`, width: `${inner.width}px`, height: `${inner.height}px` }, allowed, reason }
})
</script>

<template>
  <div
    v-if="indicator"
    class="pointer-events-none absolute z-10"
    :class="[
      indicator.kind === 'line' ? 'h-0.5' : 'rounded-sm border-2 border-dashed',
      indicator.allowed ? (indicator.kind === 'line' ? 'bg-sky-500' : 'border-sky-500 bg-sky-500/10') : indicator.kind === 'line' ? 'bg-red-500' : 'border-red-500 bg-red-500/10',
    ]"
    :style="indicator.style"
    data-testid="drop-indicator"
    :data-allowed="indicator.allowed"
  >
    <span v-if="!indicator.allowed" class="absolute top-0 left-0 -translate-y-full rounded bg-red-600 px-1.5 py-0.5 text-xs whitespace-nowrap text-white">
      {{ indicator.reason }}
    </span>
  </div>
</template>
