<script setup lang="ts">
import { MAX_SPEC_CHARS, readApiSpec } from '@feature-domain/engine'
import { computed, inject, ref } from 'vue'
import { browserFetchJson, FETCH_JSON } from '../renderer/rows'
import { isHttpUrl } from '../renderer/urls'

// The API spec's stored spec: what was loaded, a button to (re)load it from the Spec URL, and a box to paste it when
// the site doesn't allow the browser to fetch it. Generation only ever reads the stored text.
const props = defineProps<{ id: string; labelledby: string; value: string; specUrl: string }>()
const emit = defineEmits<{ change: [value: string] }>()

const fetchJson = inject(FETCH_JSON, browserFetchJson)
const loading = ref(false)
const problem = ref('')

const summary = computed(() => {
  const text = props.value.trim()
  if (text === '') return { ok: false, text: 'No spec loaded yet.' }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, text: 'The stored spec is not valid JSON.' }
  }
  const read = readApiSpec(parsed, props.specUrl)
  if ('problem' in read) return { ok: false, text: `${read.problem}.` }
  const count = read.operations.length
  return { ok: true, text: [read.format, read.title, `${count} operation${count === 1 ? '' : 's'}`].filter(Boolean).join(' · '), operations: read.operations.map((o) => o.name) }
})

const canLoad = computed(() => isHttpUrl(props.specUrl.trim()))

async function load() {
  const url = props.specUrl.trim()
  if (!isHttpUrl(url)) return
  loading.value = true
  problem.value = ''
  // A load for an address that has since been changed is ignored: its spec isn't the one now asked for.
  const stale = () => props.specUrl.trim() !== url
  try {
    const spec = await fetchJson(url)
    if (stale()) return
    const read = readApiSpec(spec, url)
    // Stored compact: specs are kept with the model in browser storage.
    const text = JSON.stringify(spec)
    if ('problem' in read) problem.value = `${read.problem}.`
    else if (text.length > MAX_SPEC_CHARS) problem.value = `The spec is too large to store (${(text.length / 1_000_000).toFixed(1)} MB; at most ${MAX_SPEC_CHARS / 1_000_000} MB).`
    else emit('change', text)
  } catch (error) {
    if (stale()) return
    const host = /^https?:\/\/([^/?#]+)/i.exec(url)?.[1] ?? url
    problem.value = `Couldn't load the spec from ${host} (${error instanceof Error ? error.message : String(error)}). If the site doesn't allow it, open the address yourself and paste the spec below.`
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="space-y-2" role="group" :aria-labelledby="labelledby" data-testid="api-spec-field">
    <p class="text-sm" :class="summary.ok ? 'text-slate-700' : 'text-slate-500'" data-testid="api-spec-summary">{{ summary.text }}</p>
    <details v-if="summary.ok && summary.operations && summary.operations.length > 0" class="text-xs text-slate-600">
      <summary class="cursor-pointer">Operations</summary>
      <ul class="mt-1 space-y-0.5 font-mono">
        <li v-for="name in summary.operations" :key="name">{{ name }}</li>
      </ul>
    </details>
    <button
      type="button"
      class="rounded-md border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50 disabled:opacity-40"
      :disabled="!canLoad || loading"
      data-testid="load-spec"
      @click="load"
    >
      {{ loading ? 'Loading…' : summary.ok ? 'Reload spec' : 'Load spec' }}
    </button>
    <p v-if="!canLoad" class="text-xs text-slate-500">Enter an http(s) Spec URL to load it.</p>
    <p v-if="problem" class="text-xs text-amber-800" role="alert" data-testid="api-spec-problem">{{ problem }}</p>
    <details class="text-xs text-slate-600">
      <summary class="cursor-pointer">Paste or edit the spec (JSON)</summary>
      <label :for="id" class="sr-only">Spec (JSON)</label>
      <textarea
        :id="id"
        rows="10"
        spellcheck="false"
        class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 font-mono text-xs leading-relaxed"
        :value="value"
        @input="emit('change', ($event.target as HTMLTextAreaElement).value)"
      />
    </details>
  </div>
</template>
