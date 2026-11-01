<script setup lang="ts">
import { pageTheme, signInDocument } from '@feature-domain/engine'
import { computed, onMounted, provide, ref, watchEffect } from 'vue'
import { loadPublishedApp, type PublishedApp } from '../published'
import { currentVisitor, SIGN_IN_PATH, SIGNED_IN } from '../renderer/account'
import DocumentView from '../renderer/DocumentView.vue'

/**
 * A published app's page (app.html), on the app's own host: the published version, rendered as the preview renders a
 * model, reading the app's live rows and its own proxy. Its sign-in page shows instead where the app asks for sign-in,
 * and at /sign-in (the Account's button and the emailed link open it), in the app's theme.
 */
const app = ref<PublishedApp | null>(null)
const onSignInPage = window.location.pathname === SIGN_IN_PATH

async function load() {
  app.value = null
  const loaded = await loadPublishedApp()
  // Someone already signed in who opens the sign-in page (an old link, a bookmark) goes on to the app.
  if (onSignInPage && loaded.status === 'ready' && loaded.signIn && (await currentVisitor().catch(() => null))) {
    window.location.replace('/')
    return
  }
  app.value = loaded
}

const signInRoot = computed(() => {
  const a = app.value
  if (a?.status === 'sign-in') return signInDocument(a.app, { ...(a.theme ? { theme: a.theme } : {}), ...(a.email ? { refused: a.email } : {}) })
  if (a?.status === 'ready' && a.signIn && onSignInPage) {
    const theme = pageTheme(a.root)
    return signInDocument(a.name, theme ? { theme } : {})
  }
  return undefined
})

watchEffect(() => {
  const a = app.value
  if (a?.status === 'sign-in') document.title = `Sign in · ${a.app}`
  else if (a?.status === 'ready') document.title = signInRoot.value ? `Sign in · ${a.name}` : a.name
})

// Once someone signs in: the app itself (from its sign-in page, at its front page), read again as them.
provide(SIGNED_IN, () => {
  if (onSignInPage) window.location.replace('/')
  else void load()
})

onMounted(load)
</script>

<template>
  <DocumentView v-if="signInRoot" :root="signInRoot" />
  <DocumentView v-else-if="app?.status === 'ready'" :root="app.root" :model-id="app.id" app />
  <p v-else-if="app?.status === 'none'">Nothing is published at this address.</p>
  <p v-else-if="app?.status === 'signed-out'">Your sign-in has expired. Reload the page to sign in again.</p>
  <div v-else-if="app?.status === 'error'" role="alert">
    <p>{{ app.message }}</p>
    <button type="button" @click="load">Try again</button>
  </div>
  <p v-else>Loading…</p>
</template>
