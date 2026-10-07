<script setup lang="ts">
import { computed, provide, ref, watch } from 'vue'
import { useDocumentStore } from '../stores/document'
import { ancestorsOf, buildFeatureTree, parentIds } from './featureTree'
import { THEME_ACCENTS, TREE_COLLAPSE, type TreeCollapse } from './treeCollapse'
import TreeRow from './TreeRow.vue'

const store = useDocumentStore()
const tree = computed(() => (store.result ? buildFeatureTree(store.result) : { roots: [], resources: [], unplaced: [] }))

// Collapsed rows are a view preference for this session, not part of the model.
const collapsed = ref(new Set<string>())
const collapse: TreeCollapse = {
  isCollapsed: (id) => collapsed.value.has(id),
  toggle(id) {
    const next = new Set(collapsed.value)
    if (!next.delete(id)) next.add(id)
    collapsed.value = next
  },
}
provide(TREE_COLLAPSE, collapse)

const all = computed(() => [...tree.value.roots, ...tree.value.resources, ...tree.value.unplaced])
const anyCollapsed = computed(() => parentIds(all.value).some((id) => collapsed.value.has(id)))
function toggleAll() {
  collapsed.value = anyCollapsed.value ? new Set() : new Set(parentIds(all.value))
}

// Selecting a feature inside a collapsed row (e.g. by clicking the page) opens the rows above it.
watch(
  () => store.selectedId,
  (id) => {
    const above = id === null ? undefined : ancestorsOf(all.value, id)
    if (!above?.some((a) => collapsed.value.has(a))) return
    collapsed.value = new Set([...collapsed.value].filter((c) => !above.includes(c)))
  },
)

/** Theme accent colours, for the swatch on Theme rows. */
const accents = computed(() => new Map((store.model?.features ?? []).filter((f) => f.feature === 'ThemeFeature').map((f) => [f.id, String(f.inputs.accent ?? '')])))
provide(THEME_ACCENTS, accents)
</script>

<template>
  <section aria-labelledby="tree-heading" data-testid="feature-tree">
    <div class="flex items-center justify-between px-1.5 pb-1.5">
      <h2 id="tree-heading" class="text-xs font-semibold tracking-wide text-slate-600 uppercase">Features</h2>
      <button
        v-if="parentIds(all).length > 0"
        type="button"
        class="text-xs text-slate-500 hover:text-slate-900"
        data-testid="tree-toggle-all"
        @click="toggleAll"
      >
        {{ anyCollapsed ? 'Expand all' : 'Collapse all' }}
      </button>
    </div>
    <ul role="tree" aria-labelledby="tree-heading">
      <TreeRow v-for="item in tree.roots" :key="item.id" :item="item" :depth="0" />
    </ul>
    <template v-if="tree.resources.length > 0">
      <h3 class="mx-1.5 mt-3.5 mb-1.5 text-xs font-medium text-slate-500">Resources and themes</h3>
      <ul role="tree" aria-label="Resources and themes">
        <TreeRow v-for="item in tree.resources" :key="item.id" :item="item" :depth="0" />
      </ul>
    </template>
    <template v-if="tree.unplaced.length > 0">
      <h3 class="mx-1.5 mt-3.5 mb-1.5 text-xs font-medium text-amber-800">Not on the page</h3>
      <ul role="tree" aria-label="Not on the page">
        <TreeRow v-for="item in tree.unplaced" :key="item.id" :item="item" :depth="0" />
      </ul>
    </template>
  </section>
</template>
