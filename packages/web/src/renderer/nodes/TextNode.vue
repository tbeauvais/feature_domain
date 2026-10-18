<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'
import { computed } from 'vue'
import { useDataStore } from '../data'
import { useEditAttrs } from '../editable'
import { cellContent, getPath } from '../filters'

// Always plain text: Vue escapes interpolation, so legacy HTML or {{...}} bindings show literally (never executed).
// With `data`, its {{path}} values are read from the data resource's answer as it loads. While loading a value shows
// "…"; one the answer doesn't have, or that couldn't be loaded, shows "—" on the page and its binding, marked, on the
// editor canvas, where the mark says why. Screen readers hear words instead of the marks.
const props = defineProps<{ node: DocNodeOf<'text'> }>()
const store = useDataStore()
const editAttrs = useEditAttrs()
const answer = store.answer(computed(() => props.node.props.data?.source))

/** `shown` is drawn, `spoken` is read by screen readers instead; `why` explains a marked value. */
type Run = { text: string } | { shown: string; spoken: string; why?: string }
const host = computed(() => {
  try {
    return new URL(props.node.props.data?.source.endPoint ?? '').host
  } catch {
    return ''
  }
})
const runs = computed((): Run[] => {
  const data = props.node.props.data
  if (!data) return [{ text: props.node.props.text }]
  const state = answer.value
  return data.parts.map((part): Run => {
    if ('text' in part) return { text: part.text }
    if (state.status === 'loading' || state.status === 'idle') return { shown: '…', spoken: 'loading' }
    const why =
      state.status === 'error'
        ? `Couldn't load from ${host.value || 'the data resource'}: ${state.message}`
        : getPath(state.response, part.path) === undefined
          ? `No value at “${part.path}”`
          : undefined
    // A value that is there shows as it is, even when empty (as the legacy app's did).
    if (why === undefined && state.status === 'loaded') return { text: cellContent(state.response, part.path, part.filter).text }
    return store.live ? { shown: '—', spoken: 'no value' } : { shown: part.binding, spoken: why ?? 'no value', why }
  })
})
</script>

<template>
  <span class="fd-text" :aria-busy="node.props.data && answer.status === 'loading' ? 'true' : undefined" v-bind="editAttrs(node, 'text')">
    <template v-for="(run, i) in runs" :key="i">
      <template v-if="'text' in run">{{ run.text }}</template>
      <span v-else :class="{ 'fd-text-missing': run.why !== undefined || run.shown === '—' }" :title="run.why"
        ><span aria-hidden="true">{{ run.shown }}</span
        ><span class="fd-visually-hidden">{{ run.spoken }}</span></span
      >
    </template>
  </span>
</template>
