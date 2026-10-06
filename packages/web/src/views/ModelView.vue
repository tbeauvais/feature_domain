<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRouter } from 'vue-router'
import FeatureTree from '../editor/FeatureTree.vue'
import Inspector from '../editor/Inspector.vue'
import Palette from '../editor/Palette.vue'
import SelectionOverlay from '../editor/SelectionOverlay.vue'
import DocumentView from '../renderer/DocumentView.vue'
import { modelStore } from '../services'
import { useDocumentStore } from '../stores/document'
import DiagnosticsList from './DiagnosticsList.vue'

const props = defineProps<{ id: string }>()
const store = useDocumentStore()
const router = useRouter()
const { model, status, error, result, generateError, selectedId, saveState, saveError } = storeToRefs(store)
const canvas = ref<HTMLElement | null>(null)

const previewUrl = (id: string) => `${import.meta.env.BASE_URL}preview.html?model=${encodeURIComponent(id)}`
const saveLabel = { saved: 'Saved', pending: 'Unsaved changes', saving: 'Saving…', error: 'Save failed' } as const

store.editing = true
watch(() => props.id, (id) => store.load(id), { immediate: true })

// Save anything pending before the page goes away (browser storage writes synchronously).
const flush = () => void store.flush()

/** Before opening another page: save pending edits, and if saving fails, ask before dropping them. */
async function confirmLeave(): Promise<boolean> {
  if (await store.flush()) return true
  return window.confirm(`Your latest changes could not be saved (${store.saveError}). Leave anyway and lose them?`)
}
onBeforeRouteLeave(confirmLeave)
onBeforeRouteUpdate(confirmLeave)
onMounted(() => window.addEventListener('pagehide', flush))
onBeforeUnmount(() => {
  window.removeEventListener('pagehide', flush)
  flush()
})

/** Clicking the page selects the feature under the pointer; links in generated pages don't navigate while editing. */
function onCanvasClick(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null
  if (target?.closest('a')) event.preventDefault()
  store.select(target?.closest('[data-feature-id]')?.getAttribute('data-feature-id') ?? null)
}

// Selecting in the tree scrolls the feature into view on the page.
watch(selectedId, (id) => {
  if (id === null) return
  requestAnimationFrame(() => canvas.value?.querySelector(`[data-feature-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' }))
})

async function deleteModel() {
  if (!model.value || !window.confirm(`Delete the model "${model.value.name}"? This cannot be undone.`)) return
  await modelStore().delete(props.id)
  await router.push('/')
}
</script>

<template>
  <p v-if="status === 'loading'" class="text-slate-500">Loading…</p>
  <p v-else-if="status === 'missing'" class="text-slate-500">This model does not exist.</p>
  <p v-else-if="status === 'error'" class="text-red-700">Could not load the model: {{ error }}</p>
  <div v-else-if="model" class="space-y-4">
    <header class="flex flex-wrap items-center gap-3">
      <label class="sr-only" for="model-name">Model name</label>
      <input
        id="model-name"
        class="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 text-2xl font-semibold hover:border-slate-300 focus:border-sky-500 focus:outline-none"
        data-testid="model-name"
        :value="model.name"
        @input="store.rename(($event.target as HTMLInputElement).value)"
      />
      <span class="text-sm" :class="saveState === 'error' ? 'text-red-700' : 'text-slate-500'" data-testid="save-state" :title="saveError">
        {{ saveLabel[saveState] }}
      </span>
      <a
        :href="previewUrl(id)"
        target="_blank"
        rel="noopener"
        class="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
        data-testid="open-preview"
      >
        Open preview
      </a>
      <button type="button" class="text-sm text-red-700 hover:underline" data-testid="delete-model" @click="deleteModel">Delete model</button>
    </header>

    <p v-if="generateError" class="text-red-700">Could not generate the model: {{ generateError }}</p>
    <div v-else-if="result" class="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)_19rem]">
      <aside class="space-y-5 rounded-lg border border-slate-200 bg-white p-3">
        <Palette />
        <FeatureTree />
      </aside>

      <div
        ref="canvas"
        class="relative cursor-default overflow-auto rounded-lg border border-slate-200 bg-white p-4"
        data-testid="canvas"
        @click="onCanvasClick"
      >
        <DocumentView :root="result.root" />
        <SelectionOverlay :container="canvas" :selected-id="selectedId" :version="result" />
      </div>

      <aside class="space-y-5 rounded-lg border border-slate-200 bg-white p-3">
        <Inspector />
        <section aria-labelledby="problems-heading">
          <h2 id="problems-heading" class="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Problems</h2>
          <DiagnosticsList :diagnostics="result.diagnostics" />
        </section>
      </aside>
    </div>
  </div>
</template>
