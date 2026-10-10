<script setup lang="ts">
import { computed, inject } from 'vue'
import { useDocumentStore } from '../stores/document'
import { dragState } from './dndState'
import { descendantCount, type TreeItem } from './featureTree'
import { collapsedRows, THEME_ACCENTS, toggleCollapsed } from './treeCollapse'

const props = defineProps<{ item: TreeItem; depth: number }>()
const store = useDocumentStore()
const accents = inject(THEME_ACCENTS, undefined)

const hasChildren = computed(() => props.item.children.length > 0)
const collapsed = computed(() => hasChildren.value && collapsedRows.value.has(props.item.id))
const swatch = computed(() => (props.item.feature === 'ThemeFeature' ? accents?.value.get(props.item.id) : undefined))

/** Drop feedback for this row while a drag hovers it in the tree. */
const drop = computed(() => {
  const state = dragState.value
  if (!state || state.surface !== 'tree' || state.zone?.kind !== 'feature' || state.zone.id !== props.item.id || !state.evaluation) return null
  if (state.evaluation.allowed && state.evaluation.noop) return null
  return { operation: state.zone.operation, allowed: state.evaluation.allowed }
})
const dropClass = computed(() => {
  const d = drop.value
  if (!d) return ''
  const color = d.allowed ? 'sky' : 'red'
  if (d.operation === 'combine') return color === 'sky' ? 'ring-2 ring-sky-500 ring-inset' : 'ring-2 ring-red-500 ring-inset'
  const edge = d.operation === 'reorder-before' ? 'shadow-[inset_0_2px_0_0]' : 'shadow-[inset_0_-2px_0_0]'
  return `${edge} ${color === 'sky' ? 'shadow-sky-500' : 'shadow-red-500'}`
})

const badge: Record<string, string> = {
  skipped: 'bg-amber-100 text-amber-800',
  unknown: 'bg-slate-100 text-slate-600',
  suppressed: 'bg-slate-100 text-slate-500',
}
const badgeText: Record<string, string> = { skipped: 'skipped', unknown: 'not ported', suppressed: 'suppressed' }
const selected = computed(() => store.selectedId === props.item.id)
</script>

<template>
  <li role="treeitem" :aria-label="item.label" :aria-selected="selected" :aria-expanded="hasChildren ? !collapsed : undefined">
    <div class="flex items-center" :style="{ paddingLeft: `${depth * 0.875}rem` }">
      <button
        v-if="hasChildren"
        type="button"
        class="grid size-5 shrink-0 place-items-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        :aria-label="`${collapsed ? 'Expand' : 'Collapse'} ${item.label}`"
        :data-testid="`tree-toggle-${item.id}`"
        @click="toggleCollapsed(item.id)"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" :class="collapsed ? '-rotate-90' : ''">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <span v-else class="size-5 shrink-0" aria-hidden="true" />
      <button
        type="button"
        class="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[13px] hover:bg-slate-100"
        :class="[{ 'bg-sky-50 shadow-[inset_2px_0_0_0] shadow-sky-600 hover:bg-sky-50': selected, 'text-slate-400': item.status === 'suppressed' }, dropClass]"
        :data-drop="drop ? `${drop.operation}${drop.allowed ? '' : ':blocked'}` : undefined"
        :data-tree-id="item.id"
        :title="item.reason"
        @click="store.select(item.id)"
      >
        <span v-if="swatch" aria-hidden="true" class="size-3 shrink-0 rounded" :style="{ backgroundColor: swatch }" />
        <span v-if="item.slot" class="font-mono text-[10px] text-slate-400">{{ item.slot }}</span>
        <span class="min-w-0 flex-auto truncate" :class="{ 'font-medium': depth === 0 && hasChildren }">{{ item.label }}</span>
        <span v-if="collapsed" class="shrink-0 text-[11px] text-slate-500" :title="`${descendantCount(item)} features inside`">{{ descendantCount(item) }}</span>
        <!-- The type (or a page's theme) yields space to the name; a status badge replaces it (the tooltip says why). -->
        <span v-else-if="item.status === 'generated'" class="min-w-0 shrink-[4] truncate text-[11px] text-slate-500">{{ item.detail ?? item.type }}</span>
        <span v-if="item.status !== 'generated'" class="shrink-0 rounded-full px-1.5 text-[11px]" :class="badge[item.status]">{{ badgeText[item.status] }}</span>
      </button>
    </div>
    <ul v-if="hasChildren && !collapsed" role="group">
      <TreeRow v-for="child in item.children" :key="child.id" :item="child" :depth="depth + 1" />
    </ul>
  </li>
</template>
