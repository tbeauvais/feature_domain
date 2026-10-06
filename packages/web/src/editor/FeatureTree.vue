<script setup lang="ts">
import { computed } from 'vue'
import { useDocumentStore } from '../stores/document'
import { buildFeatureTree } from './featureTree'
import TreeRow from './TreeRow.vue'

const store = useDocumentStore()
const tree = computed(() => (store.result ? buildFeatureTree(store.result) : { roots: [], unplaced: [] }))
</script>

<template>
  <section aria-labelledby="tree-heading" data-testid="feature-tree">
    <h2 id="tree-heading" class="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Features</h2>
    <ul role="tree" aria-labelledby="tree-heading">
      <TreeRow v-for="item in tree.roots" :key="item.id" :item="item" :depth="0" />
    </ul>
    <template v-if="tree.unplaced.length > 0">
      <h3 class="mt-3 mb-1 text-xs font-medium text-slate-500">Not on the page</h3>
      <ul role="tree" aria-label="Not on the page">
        <TreeRow v-for="item in tree.unplaced" :key="item.id" :item="item" :depth="0" />
      </ul>
    </template>
  </section>
</template>
