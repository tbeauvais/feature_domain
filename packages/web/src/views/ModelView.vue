<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRouter } from 'vue-router'
import BrandLink from '../components/BrandLink.vue'
import FeatureTree from '../editor/FeatureTree.vue'
import Inspector from '../editor/Inspector.vue'
import Palette from '../editor/Palette.vue'
import DropIndicator from '../editor/DropIndicator.vue'
import SelectionOverlay from '../editor/SelectionOverlay.vue'
import ShortcutsDialog from '../editor/ShortcutsDialog.vue'
import StatusBar from '../editor/StatusBar.vue'
import { REDO_KEYS, UNDO_KEYS } from '../editor/keys'
import { themeSummary } from '../editor/status'
import { CANVAS_WIDTHS, loadCanvasWidth, saveCanvasWidth, type CanvasWidth } from '../editor/canvasWidth'
import { useEditorDnd } from '../editor/useEditorDnd'
import DocumentView from '../renderer/DocumentView.vue'
import { modelStore } from '../services'
import { confirmAction, pendingConfirm } from '../editor/confirm'
import { useDocumentStore } from '../stores/document'
import DiagnosticsList from './DiagnosticsList.vue'

const props = defineProps<{ id: string }>()
const store = useDocumentStore()
const router = useRouter()
const { model, status, error, result, generateError, selectedId, saveState, saveError, canUndo, canRedo } = storeToRefs(store)
const canvas = ref<HTMLElement | null>(null)
const tree = ref<HTMLElement | null>(null)
const palette = ref<HTMLElement | null>(null)
useEditorDnd({ canvas, tree, palette })


const TEXT_INPUT_TYPES = ['text', 'search', 'url', 'tel', 'email', 'password', 'number']

/** Text-entry fields have the browser's own undo for the text being typed; other controls (selects, checkboxes) don't. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true
  return target instanceof HTMLInputElement && TEXT_INPUT_TYPES.includes(target.type)
}

const shortcuts = ref<InstanceType<typeof ShortcutsDialog> | null>(null)

/** Undo/redo shortcuts and `?` for the shortcuts list, except in text fields and while a confirmation dialog is open. */
function onKeydown(event: KeyboardEvent) {
  if (pendingConfirm.value !== null || shortcuts.value?.isOpen() || isTextEntry(event.target)) return
  if (event.key === '?' && !event.metaKey && !event.ctrlKey && !event.altKey) {
    shortcuts.value?.open()
    event.preventDefault()
    return
  }
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return
  const key = event.key.toLowerCase()
  if (key === 'z' && !event.shiftKey) store.undo()
  else if ((key === 'z' && event.shiftKey) || key === 'y') store.redo()
  else return
  event.preventDefault()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

const previewUrl = (id: string) => `${import.meta.env.BASE_URL}preview.html?model=${encodeURIComponent(id)}`
const saveLabel = { saved: 'Saved', pending: 'Unsaved changes', saving: 'Saving…', error: 'Save failed' } as const

store.editing = true
watch(() => props.id, (id) => store.load(id), { immediate: true })

// Save anything pending before the page goes away (browser storage writes synchronously).
const flush = () => void store.flush()

/** Before opening another page: save pending edits, and if saving fails, ask before dropping them. */
async function confirmLeave(): Promise<boolean> {
  if (await store.flush()) return true
  return confirmAction({
    title: 'Leave without saving?',
    description: `Your latest changes could not be saved (${store.saveError}). Leave anyway and lose them?`,
    confirmLabel: 'Leave',
    destructive: true,
  })
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

/** Middle-click (and other non-primary clicks) on a link in the page doesn't open it either. */
function onCanvasAuxClick(event: MouseEvent) {
  if (event.target instanceof Element && event.target.closest('a')) event.preventDefault()
}

// Selecting in the tree scrolls the feature into view on the page.
watch(selectedId, (id) => {
  if (id === null) return
  requestAnimationFrame(() => canvas.value?.querySelector(`[data-feature-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' }))
})

// Canvas width: the generated page sizes itself from its own width, so Tablet and Phone show what those devices would.
const canvasWidth = ref<CanvasWidth>(loadCanvasWidth())
watch(canvasWidth, saveCanvasWidth)

const problemsOpen = ref(false)

const themes = computed(() => (result.value ? themeSummary(result.value) : ''))

/** Closing the problems panel returns focus to the status bar button that opened it. */
function closeProblems() {
  problemsOpen.value = false
  void nextTick(() => document.querySelector<HTMLElement>('[data-testid="problems-toggle"]')?.focus())
}

async function deleteModel() {
  if (!model.value) return
  const confirmed = await confirmAction({
    title: `Delete the model "${model.value.name}"?`,
    description: 'This cannot be undone.',
    confirmLabel: 'Delete model',
    destructive: true,
  })
  if (!confirmed) return
  // The model is going away: an edit still waiting to be saved must not be saved (or trip the leave guard).
  store.discard()
  await modelStore().delete(props.id)
  await router.push('/')
}
</script>

<template>
  <div class="flex min-h-screen flex-col lg:h-screen">
    <header class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-4 py-2.5">
      <BrandLink />
      <template v-if="model">
        <span class="text-slate-400" aria-hidden="true">/</span>
        <label class="sr-only" for="model-name">Model name</label>
        <input
          id="model-name"
          class="w-48 min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1 text-[15px] font-semibold hover:border-slate-300 focus:border-sky-500 focus:outline-none sm:w-64"
          data-testid="model-name"
          :value="model.name"
          @input="store.rename(($event.target as HTMLInputElement).value)"
        />
        <span class="inline-flex items-center gap-1.5 text-[13px]" :class="saveState === 'error' ? 'text-red-700' : 'text-slate-600'" :title="saveError">
          <svg v-if="saveState === 'saved'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="text-green-600">
            <path d="M20 6 9 17l-5-5" />
          </svg>
          <span data-testid="save-state">{{ saveLabel[saveState] }}</span>
        </span>
        <span class="flex-1" />
        <div class="flex gap-1">
          <button type="button" class="grid size-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40" data-testid="undo" aria-label="Undo" :title="`Undo (${UNDO_KEYS})`" :disabled="!canUndo" @click="store.undo()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>
          </button>
          <button type="button" class="grid size-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40" data-testid="redo" aria-label="Redo" :title="`Redo (${REDO_KEYS})`" :disabled="!canRedo" @click="store.redo()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg>
          </button>
        </div>
        <button type="button" class="h-9 rounded-lg border border-slate-200 bg-white px-3 text-slate-700 hover:bg-slate-50" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" data-testid="shortcuts" @click="shortcuts?.open()">?</button>
        <a
          :href="previewUrl(id)"
          target="_blank"
          rel="noopener"
          class="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-900 px-3.5 text-sm font-medium text-white hover:bg-slate-700"
          data-testid="open-preview"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
          Preview
        </a>
        <button type="button" class="grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-700" aria-label="Delete model" title="Delete model" data-testid="delete-model" @click="deleteModel">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
        </button>
      </template>
    </header>

    <p v-if="status === 'loading'" class="p-6 text-slate-500">Loading…</p>
    <p v-else-if="status === 'missing'" class="p-6 text-slate-500">This model does not exist.</p>
    <p v-else-if="status === 'error'" class="p-6 text-red-700">Could not load the model: {{ error }}</p>
    <p v-else-if="model && generateError" class="p-6 text-red-700">Could not generate the model: {{ generateError }}</p>
    <template v-else-if="model && result">
      <div class="flex min-h-0 flex-1 flex-col lg:flex-row">
        <!-- On short windows the tree keeps a usable height and the whole column scrolls instead. -->
        <aside class="flex flex-col border-b border-slate-200 bg-white lg:min-h-0 lg:w-72 lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-b-0">
          <div ref="palette" class="shrink-0 px-3.5 pt-3.5 pb-3"><Palette /></div>
          <div ref="tree" class="flex-1 border-t border-slate-200 px-2 pt-3 pb-4 lg:min-h-48 lg:overflow-auto"><FeatureTree /></div>
        </aside>

        <main class="flex min-h-0 min-w-0 flex-1 flex-col">
          <div class="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2">
            <div role="group" aria-label="Canvas width" class="inline-flex overflow-hidden rounded-lg border border-slate-200 bg-white">
              <button
                v-for="(option, key) in CANVAS_WIDTHS"
                :key="key"
                type="button"
                class="px-3 py-1.5 text-[13px]"
                :class="canvasWidth === key ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'"
                :aria-pressed="canvasWidth === key"
                :data-testid="`canvas-width-${key}`"
                @click="canvasWidth = key"
              >
                {{ option.label }}
              </button>
            </div>
            <span class="flex-1" />
            <span class="text-xs text-slate-600" data-testid="theme-summary">{{ themes }}</span>
          </div>
          <div class="min-h-0 flex-1 overflow-auto bg-slate-100 p-4 lg:p-6">
            <div
              ref="canvas"
              class="fd-editor-canvas relative mx-auto cursor-default border border-slate-200 bg-white shadow-sm"
              :style="{ width: CANVAS_WIDTHS[canvasWidth].width }"
              data-testid="canvas"
              :data-canvas-width="canvasWidth"
              @click="onCanvasClick"
              @auxclick="onCanvasAuxClick"
            >
              <DocumentView :root="result.root" />
              <SelectionOverlay :container="canvas" :selected-id="selectedId" :version="result" />
              <DropIndicator :container="canvas" />
            </div>
          </div>
        </main>

        <aside class="border-t border-slate-200 bg-white p-4 lg:w-80 lg:shrink-0 lg:overflow-auto lg:border-t-0 lg:border-l">
          <Inspector />
        </aside>
      </div>

      <section
        v-if="problemsOpen"
        id="problems-panel"
        aria-labelledby="problems-heading"
        class="max-h-[40vh] overflow-auto border-t border-slate-200 bg-white px-4 py-3"
      >
        <div class="mb-2 flex items-center justify-between">
          <h2 id="problems-heading" class="text-xs font-semibold tracking-wide text-slate-600 uppercase">Problems</h2>
          <button type="button" class="text-xs text-slate-500 hover:text-slate-900" @click="closeProblems">Close</button>
        </div>
        <DiagnosticsList :diagnostics="result.diagnostics" />
      </section>
      <StatusBar :result="result" :problems-open="problemsOpen" @toggle-problems="problemsOpen = !problemsOpen" />
    </template>
    <ShortcutsDialog ref="shortcuts" />
  </div>
</template>
