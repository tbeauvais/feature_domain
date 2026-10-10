<script setup lang="ts">
import type { GenerateResult } from '@feature-domain/engine'
import { computed } from 'vue'
import { UNDO_KEYS } from './keys'
import { summarize } from './status'

const props = defineProps<{ result: GenerateResult; problemsOpen: boolean }>()
defineEmits<{ toggleProblems: [] }>()

const summary = computed(() => summarize(props.result))
</script>

<template>
  <footer class="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-200 bg-white px-4 py-1.5 text-xs text-slate-600" data-testid="status-bar">
    <button
      type="button"
      class="inline-flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-slate-100"
      :class="summary.problems > 0 ? 'text-amber-800' : 'text-slate-600'"
      :aria-expanded="problemsOpen"
      aria-controls="problems-panel"
      data-testid="problems-toggle"
      @click="$emit('toggleProblems')"
    >
      <svg v-if="summary.problems > 0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      </svg>
      <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="text-green-600">
        <path d="M20 6 9 17l-5-5" />
      </svg>
      {{ summary.problemsLabel }}
    </button>
    <span data-testid="status-counts">{{ summary.countsLabel }}</span>
    <span class="flex-1" />
    <span class="hidden sm:inline">Drag to move · {{ UNDO_KEYS }} undo · ? shortcuts</span>
  </footer>
</template>
