<script setup lang="ts">
import type { DocNode } from '@feature-domain/engine'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDocumentStore } from '../stores/document'
import { dragState } from './dndState'

// Says what to do on an empty page, with quick-add buttons. Like the selection outline it lives outside the generated
// page (.fd-root), positioned over the page's box, so the preview stays blank. It steps aside while something is
// dragged, so drops still land on the page underneath.
const props = defineProps<{ container: HTMLElement | null; root: DocNode }>()

const store = useDocumentStore()

/** Pages with nothing on them (placeholders count as something: they can be selected and deleted). */
const emptyPages = computed(() => props.root.children.filter((n) => n.kind === 'page' && n.children.length === 0).map((n) => n.id))

const QUICK_ADD = [
  { type: 'HeaderFeature', label: 'Header' },
  { type: 'TextFeature', label: 'Text' },
  { type: 'ImageFeature', label: 'Image' },
]

const boxes = ref<{ id: string; top: number; left: number; width: number; height: number }[]>([])

function measure() {
  const container = props.container
  if (!container) {
    boxes.value = []
    return
  }
  const outer = container.getBoundingClientRect()
  boxes.value = emptyPages.value.flatMap((id) => {
    const el = container.querySelector(`[data-node-id="${CSS.escape(id)}"]`)
    if (!el) return []
    const inner = el.getBoundingClientRect()
    return [
      {
        id,
        top: inner.top - outer.top - container.clientTop + container.scrollTop,
        left: inner.left - outer.left - container.clientLeft + container.scrollLeft,
        width: inner.width,
        height: inner.height,
      },
    ]
  })
}

watch(() => [props.container, props.root], () => void nextTick(measure), { immediate: true })

let observer: ResizeObserver | undefined
onMounted(() => {
  window.addEventListener('resize', measure)
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
  observer?.disconnect()
})
</script>

<template>
  <template v-if="dragState === null">
    <div
      v-for="box in boxes"
      :key="box.id"
      class="pointer-events-none absolute flex items-center justify-center p-4"
      :style="{ top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px`, height: `${box.height}px` }"
      data-testid="empty-page-hint"
    >
      <div class="flex max-w-sm flex-col items-center gap-2 rounded-lg border border-slate-200 bg-white/95 px-6 py-5 text-center shadow-sm">
        <svg width="60" height="45" viewBox="0 0 120 90" aria-hidden="true" class="text-slate-400">
          <rect x="8" y="8" width="104" height="74" rx="10" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="5 5" />
          <rect x="30" y="28" width="60" height="34" rx="6" fill="white" stroke="currentColor" stroke-width="2" />
          <path d="M60 37v16M52 45h16" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
        </svg>
        <p class="text-base font-semibold text-slate-900">This page is empty</p>
        <p class="text-sm text-slate-600">Click a feature in Add, or drag one here. Start with one of these:</p>
        <!-- Only the buttons take the pointer: anywhere else, clicks and drops reach the page underneath. -->
        <div class="pointer-events-auto flex flex-wrap justify-center gap-2" @click.stop>
          <button
            v-for="item in QUICK_ADD"
            :key="item.type"
            type="button"
            class="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm text-slate-900 hover:bg-slate-50"
            :data-testid="`quick-add-${item.type}`"
            @click="store.addAt(item.type, { parent: box.id, slot: 'content' })"
          >
            {{ item.label }}
          </button>
        </div>
      </div>
    </div>
  </template>
</template>
