<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { watch } from 'vue'
import DocumentView from '../renderer/DocumentView.vue'
import { useDocumentStore } from '../stores/document'
import DiagnosticsList from './DiagnosticsList.vue'

const props = defineProps<{ id: string }>()
const store = useDocumentStore()
const { model, status, error, result, generateError } = storeToRefs(store)
const previewUrl = (id: string) => `${import.meta.env.BASE_URL}preview.html?model=${encodeURIComponent(id)}`

watch(() => props.id, (id) => store.load(id), { immediate: true })
</script>

<template>
  <p v-if="status === 'loading'" class="text-slate-500">Loading…</p>
  <p v-else-if="status === 'missing'" class="text-slate-500">This model does not exist.</p>
  <p v-else-if="status === 'error'" class="text-red-700">Could not load the model: {{ error }}</p>
  <p v-else-if="generateError" class="text-red-700">Could not generate the model: {{ generateError }}</p>
  <div v-else-if="model && result" class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
    <section>
      <div class="mb-3 flex items-center justify-between gap-4">
        <h1 class="text-2xl font-semibold" data-testid="model-name">{{ model.name }}</h1>
        <a
          :href="previewUrl(id)"
          target="_blank"
          rel="noopener"
          class="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
          data-testid="open-preview"
        >
          Open preview
        </a>
      </div>
      <div class="overflow-hidden rounded-lg border border-slate-200 bg-white p-4" data-testid="canvas">
        <DocumentView :root="result.root" />
      </div>
    </section>
    <aside class="rounded-lg border border-slate-200 bg-white p-4">
      <h2 class="mb-3 font-semibold">Diagnostics</h2>
      <DiagnosticsList :diagnostics="result.diagnostics" />
    </aside>
  </div>
</template>
