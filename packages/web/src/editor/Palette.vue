<script setup lang="ts">
import { coreFeatures } from '@feature-domain/engine'
import { useDocumentStore } from '../stores/document'

const store = useDocumentStore()
</script>

<template>
  <section aria-labelledby="palette-heading">
    <h2 id="palette-heading" class="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Add feature</h2>
    <div class="grid grid-cols-2 gap-1.5">
      <button
        v-for="def in coreFeatures"
        :key="def.type"
        type="button"
        class="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-left text-sm hover:border-slate-400 hover:bg-slate-50"
        :data-testid="`palette-${def.type}`"
        :title="def.placement === 'none' ? `${def.name} (not placed on the page)` : `Add ${def.name}`"
        @click="store.add(def.type)"
      >
        {{ def.name }}
      </button>
    </div>
  </section>
</template>
