<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { loadPublishedApp, type PublishedApp } from '../published'
import DocumentView from '../renderer/DocumentView.vue'

/**
 * A published app's page (app.html), on the app's own host: the published version, rendered as the preview renders a
 * model, reading the app's live rows and its own proxy.
 */
const app = ref<PublishedApp | null>(null)

async function load() {
  app.value = null
  app.value = await loadPublishedApp()
  if (app.value.status === 'ready') document.title = app.value.name
}

onMounted(load)
</script>

<template>
  <DocumentView v-if="app?.status === 'ready'" :root="app.root" :model-id="app.id" app />
  <p v-else-if="app?.status === 'none'">Nothing is published at this address.</p>
  <p v-else-if="app?.status === 'signed-out'">Your sign-in has expired. Reload the page to sign in again.</p>
  <p v-else-if="app?.status === 'sign-in' && app.email">{{ app.app }} is open only to the people it lists, and {{ app.email }} isn't one of them.</p>
  <p v-else-if="app?.status === 'sign-in'">{{ app.app }} is open only to people signed in.</p>
  <div v-else-if="app?.status === 'error'" role="alert">
    <p>{{ app.message }}</p>
    <button type="button" @click="load">Try again</button>
  </div>
  <p v-else>Loading…</p>
</template>
