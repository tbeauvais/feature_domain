<script setup lang="ts">
import { useDocumentStore } from '../stores/document'
import FeatureIcon from './FeatureIcon.vue'
import { paletteGroups } from './palette'

const store = useDocumentStore()
const groups = paletteGroups()
</script>

<template>
  <section aria-labelledby="palette-heading">
    <div class="flex items-baseline justify-between">
      <h2 id="palette-heading" class="text-xs font-semibold tracking-wide text-slate-600 uppercase">Add</h2>
      <span class="text-xs text-slate-500">Click or drag onto the page</span>
    </div>
    <template v-for="group in groups" :key="group.label">
      <h3 class="mt-3 mb-1.5 text-xs font-medium text-slate-500">{{ group.label }}</h3>
      <div class="grid grid-cols-3 gap-1.5">
        <button
          v-for="{ def, label } in group.items"
          :key="def.type"
          type="button"
          class="flex flex-col items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-1 py-2.5 text-xs text-slate-800 hover:border-slate-400 hover:bg-slate-50"
          :class="def.placement === 'none' ? 'cursor-pointer' : 'cursor-grab'"
          :data-testid="`palette-${def.type}`"
          :data-palette-type="def.placement === 'none' ? undefined : def.type"
          :title="def.placement === 'none' ? `Add ${def.name} (not placed on the page)` : `Add ${def.name}, or drag it onto the page`"
          @click="store.add(def.type)"
        >
          <FeatureIcon :type="def.type" class="text-slate-700" />
          {{ label }}
        </button>
      </div>
    </template>
  </section>
</template>
