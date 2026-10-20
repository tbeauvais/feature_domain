<script setup lang="ts">
import { defaultRegistry, generate, migrate, validateModel, type DocNode } from '@feature-domain/engine'
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import ModelList from '../components/ModelList.vue'
import SiteHeader from '../components/SiteHeader.vue'
import { confirmAction } from '../editor/confirm'
import DocumentView from '../renderer/DocumentView.vue'
import { homeReset, modelStore } from '../services'
import { HOME_ID } from '../stores/apiModelStore'

/**
 * The home page is a model of its own (`HOME_ID`), shown as the preview shows a model. When it is missing or can't be
 * shown (invalid, or generating with errors or no page), the built-in model list takes its place, offering to put the
 * built-in home page back. The links above it stay outside the generated page, so no edit removes the way back.
 */
type State =
  | { status: 'loading' }
  | { status: 'ready'; root: DocNode }
  | { status: 'missing' }
  | { status: 'broken'; reason: string }
  | { status: 'error'; message: string }

const state = ref<State>({ status: 'loading' })
const resetting = ref(false)
const resetError = ref('')
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

async function load() {
  state.value = { status: 'loading' }
  let stored
  try {
    stored = await modelStore().get(HOME_ID)
  } catch (e) {
    state.value = { status: 'error', message: message(e) }
    return
  }
  if (!stored) {
    state.value = { status: 'missing' }
    return
  }
  const problems = validateModel(stored.model)
  if (problems.length > 0) {
    state.value = { status: 'broken', reason: `it is not a valid model: ${problems[0]}` }
    return
  }
  try {
    const result = generate(migrate(stored.model).model, defaultRegistry)
    const error = result.diagnostics.find((d) => d.severity === 'error')
    if (error) state.value = { status: 'broken', reason: error.message }
    else if (result.root.children.length === 0) state.value = { status: 'broken', reason: 'it has no page' }
    else state.value = { status: 'ready', root: result.root }
  } catch (e) {
    state.value = { status: 'broken', reason: message(e) }
  }
}

async function reset() {
  // A broken home page may hold edits worth fixing instead; a missing one holds nothing.
  if (
    state.value.status === 'broken' &&
    !(await confirmAction({
      title: 'Reset the home page?',
      description: 'The built-in home page replaces this one, and the changes made to it are lost.',
      confirmLabel: 'Reset home page',
      destructive: true,
    }))
  )
    return
  resetting.value = true
  resetError.value = ''
  try {
    await homeReset()()
  } catch (e) {
    resetError.value = message(e)
    return
  } finally {
    resetting.value = false
  }
  await load()
}

onMounted(load)
</script>

<template>
  <SiteHeader>
    <RouterLink to="/models" class="text-slate-700 hover:text-slate-900">All models</RouterLink>
    <RouterLink v-if="state.status !== 'missing'" :to="{ name: 'model', params: { id: HOME_ID } }" class="text-slate-700 hover:text-slate-900">
      Edit home page
    </RouterLink>
  </SiteHeader>
  <main v-if="state.status === 'ready'" data-testid="home-page">
    <DocumentView :root="state.root" :model-id="HOME_ID" />
  </main>
  <p v-else-if="state.status === 'loading'" class="mx-auto max-w-7xl px-4 py-6 text-slate-500">Loading…</p>
  <ModelList v-else>
    <div
      class="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
      role="status"
      data-testid="home-fallback"
    >
      <p v-if="state.status === 'error'">Could not load the home page: {{ state.message }}.</p>
      <p v-else-if="state.status === 'missing'">There is no home page, so here is the model list.</p>
      <p v-else>The home page can't be shown ({{ state.reason }}), so here is the model list.</p>
      <button
        v-if="state.status === 'error'"
        type="button"
        class="rounded-md border border-amber-400 bg-white px-3 py-1.5 font-medium hover:bg-amber-100"
        @click="load"
      >
        Try again
      </button>
      <button
        v-else
        type="button"
        class="rounded-md border border-amber-400 bg-white px-3 py-1.5 font-medium hover:bg-amber-100 disabled:opacity-60"
        :disabled="resetting"
        data-testid="reset-home"
        @click="reset"
      >
        Reset home page
      </button>
      <p v-if="resetError" class="basis-full text-red-700" role="alert">Could not reset the home page: {{ resetError }}.</p>
    </div>
  </ModelList>
</template>
