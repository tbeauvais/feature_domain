<script setup lang="ts">
import type { Diagnostic } from '@feature-domain/engine'

defineProps<{ diagnostics: Diagnostic[] }>()

const severityClass: Record<Diagnostic['severity'], string> = {
  error: 'bg-red-100 text-red-800',
  warning: 'bg-amber-100 text-amber-800',
  info: 'bg-sky-100 text-sky-800',
}
</script>

<template>
  <p v-if="diagnostics.length === 0" class="text-sm text-slate-600" data-testid="no-problems">
    <span class="text-green-700" aria-hidden="true">✓</span> No problems. A feature with a problem would be listed here, with the reason.
  </p>
  <ul v-else class="space-y-2" data-testid="diagnostics">
    <li v-for="(d, i) in diagnostics" :key="i" class="text-sm" :data-code="d.code">
      <span class="mr-2 rounded px-1.5 py-0.5 text-xs font-medium" :class="severityClass[d.severity]">{{ d.severity }}</span>
      <span v-if="d.featureInstanceId !== undefined" class="mr-1 font-mono text-xs text-slate-500">#{{ d.featureInstanceId }}</span>
      <span>{{ d.message }}</span>
    </li>
  </ul>
</template>
