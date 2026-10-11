<script setup lang="ts">
import { readApiSpec } from '@feature-domain/engine'
import { computed, inject, ref } from 'vue'
import { browserFetchJson, FETCH_JSON } from '../renderer/rows'
import { isHttpUrl } from '../renderer/urls'

// The API spec's stored spec: what was loaded, a button to (re)load it from the Spec URL, and a box to paste it when
// the site doesn't allow the browser to fetch it. Generation only ever reads the stored text.
const props = defineProps<{ id: string; value: string; specUrl: string }>()
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
  try {
    const spec = await fetchJson(url)
    const read = readApiSpec(spec, url)
    if ('problem' in read) problem.value = `${read.problem}.`
    else emit('change', JSON.stringify(spec, null, 2))
  } catch (error) {
    const host = /^https?:\/\/([^/?#]+)/i.exec(url)?.[1] ?? url
    problem.value = `Couldn't load the spec from ${host} (${error instanceof Error ? error.message : String(error)}). If the site doesn't allow it, open the address yourself and paste the spec below.`
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="space-y-2" data-testid="api-spec-field">
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
