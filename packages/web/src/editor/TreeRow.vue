<script setup lang="ts">
import { useDocumentStore } from '../stores/document'
import type { TreeItem } from './featureTree'

defineProps<{ item: TreeItem; depth: number }>()
const store = useDocumentStore()

const badge: Record<string, string> = {
  skipped: 'bg-amber-100 text-amber-800',
  unknown: 'bg-slate-200 text-slate-700',
  suppressed: 'bg-slate-100 text-slate-500',
}
</script>

<template>
  <li role="treeitem" :aria-selected="store.selectedId === item.id" :aria-expanded="item.children.length > 0 ? true : undefined">
    <button
      type="button"
      class="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-sm hover:bg-slate-100"
      :class="{ 'bg-sky-100 hover:bg-sky-100': store.selectedId === item.id, 'text-slate-400': item.status === 'suppressed' }"
      :style="{ paddingLeft: `${0.375 + depth * 0.875}rem` }"
      :data-tree-id="item.id"
      :title="item.reason"
      @click="store.select(item.id)"
    >
      <span v-if="item.slot" class="font-mono text-[10px] text-slate-400">{{ item.slot }}</span>
      <span class="min-w-0 flex-auto truncate">{{ item.label }}</span>
      <!-- The type yields space to the name; a status badge replaces it (the row's tooltip says why). -->
      <span v-if="item.status === 'generated'" class="min-w-0 shrink-[4] truncate text-[10px] text-slate-400">{{ item.feature.replace(/Feature$/, '') }}</span>
      <span v-if="item.status !== 'generated'" class="shrink-0 rounded px-1 text-[10px]" :class="badge[item.status]">{{ item.status }}</span>
    </button>
    <ul v-if="item.children.length > 0" role="group">
      <TreeRow v-for="child in item.children" :key="child.id" :item="child" :depth="depth + 1" />
    </ul>
  </li>
</template>
