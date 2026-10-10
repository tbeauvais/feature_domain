<script setup lang="ts">
import { ref, watch } from 'vue'
import { useDocumentStore } from '../stores/document'
import FeatureIcon from './FeatureIcon.vue'
import { paletteGroups } from './palette'
import { loadPref, savePref } from './prefs'

const store = useDocumentStore()
const groups = paletteGroups()

// Folding the palette gives the feature tree the room; remembered per browser. Folded tiles stay in the DOM (v-show),
// so drag and drop keeps its registrations.
const open = ref(loadPref('palette', ['open', 'folded'], 'open') === 'open')
watch(open, (value) => savePref('palette', value ? 'open' : 'folded'))
</script>

<template>
  <section aria-labelledby="palette-heading">
    <div class="flex items-center justify-between gap-2">
      <h2 id="palette-heading" class="text-xs font-semibold tracking-wide text-slate-600 uppercase">
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded hover:text-slate-900"
          :aria-expanded="open"
          aria-controls="palette-groups"
          data-testid="palette-toggle"
          @click="open = !open"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" :class="open ? '' : '-rotate-90'">
            <path d="m6 9 6 6 6-6" />
          </svg>
          Add
        </button>
      </h2>
      <span v-show="open" class="text-xs text-slate-500">Click or drag onto the page</span>
    </div>
    <div v-show="open" id="palette-groups">
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
    </div>
  </section>
</template>
