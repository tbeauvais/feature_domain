<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'
import { computed } from 'vue'
import { useDataStore } from '../data'
import { cellContent } from '../filters'

// Always plain text: Vue escapes interpolation, so legacy HTML or {{...}} bindings show literally (never executed).
// With `data`, its {{path}} values are read from the data resource's answer as it loads: "…" while loading; a value
// that isn't there shows as "—" on the page, and as its binding (marked) on the editor canvas.
const props = defineProps<{ node: DocNodeOf<'text'> }>()
const store = useDataStore()
const answer = store.answer(computed(() => props.node.props.data?.source))

type Run = { text: string; missing?: string }
const runs = computed((): Run[] => {
  const data = props.node.props.data
  if (!data) return [{ text: props.node.props.text }]
  const state = answer.value
  return data.parts.map((part): Run => {
    if ('text' in part) return { text: part.text }
    if (state.status === 'loading' || state.status === 'idle') return { text: '…' }
    const value = state.status === 'loaded' ? cellContent(state.response, part.path, part.filter).text : ''
    return value !== '' ? { text: value } : { text: store.live ? '—' : part.binding, missing: part.path }
  })
})
</script>

<template>
  <span class="fd-text" :aria-busy="node.props.data && answer.status === 'loading' ? 'true' : undefined">
    <template v-for="(run, i) in runs" :key="i">
      <span v-if="run.missing !== undefined" class="fd-text-missing" :title="`No value at “${run.missing}”`">{{ run.text }}</span>
      <template v-else>{{ run.text }}</template>
    </template>
  </span>
</template>
