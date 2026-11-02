<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'
import { computed, nextTick, onMounted, ref, useId } from 'vue'
import { deleteAccount, downloadAccount, SIGN_IN_PATH, signOut, SignInError } from '../account'
import { useEditAttrs } from '../editable'
import { useDataStore } from '../data'

/**
 * The visitor's account, on a published app with sign-in: Sign in for someone signed out; for someone signed in, who
 * they are, Sign out, Download my data and Delete my account (asked inline first). In the builder, never signed in, it
 * shows the signed-out look and does nothing; on an app without sign-in, nothing at all.
 */
defineProps<{ node: DocNodeOf<'account'> }>()
const store = useDataStore()
const editAttrs = useEditAttrs()
const id = useId()

/** What it shows, from who the page knows is signed in (the store's, shared with the table rules' controls). */
const state = computed(() => {
  if (!store.onApp) return 'builder'
  const known = store.visitor.value
  if (known.status === 'known') return known.visitor ? 'signed-in' : 'signed-out'
  return known.status === 'no-sign-in' ? 'none' : known.status === 'failed' ? 'failed' : 'loading'
})
const visitor = computed(() => (store.visitor.value.status === 'known' ? store.visitor.value.visitor : null))
const busy = ref(false)
const confirming = ref(false)
const problem = ref('')
const deleteButton = ref<HTMLButtonElement>()
const confirmButton = ref<HTMLButtonElement>()

// The page asks who is signed in once; Try again asks again.
const load = () => void store.whoIsSignedIn().catch(() => undefined)
onMounted(() => {
  if (store.onApp && store.visitor.value.status === 'unknown') load()
})

async function attempt(work: () => Promise<void>) {
  busy.value = true
  problem.value = ''
  try {
    await work()
  } catch (e) {
    problem.value = e instanceof SignInError ? e.message : 'Something went wrong. Try again.'
  } finally {
    busy.value = false
  }
}

// Signing out or deleting opens the app afresh: what it shows may depend on who is signed in.
const leave = () => attempt(async () => (await signOut(), window.location.assign('/')))
const remove = () => attempt(async () => (await deleteAccount(), window.location.assign('/')))

// Fetched rather than linked, so a session that ended meanwhile is said, not saved as a file.
const download = () =>
  attempt(async () => {
    const file = URL.createObjectURL(await downloadAccount())
    const link = document.createElement('a')
    link.href = file
    link.download = 'account.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(file), 0)
  })

async function ask() {
  confirming.value = true
  await nextTick()
  confirmButton.value?.focus()
}
async function keep() {
  confirming.value = false
  problem.value = ''
  await nextTick()
  deleteButton.value?.focus()
}
</script>

<template>
  <div v-if="state !== 'none' && state !== 'loading'" class="fd-account" :class="`fd-align-${node.props.align}`">
    <span
      v-if="state === 'builder'"
      class="fd-button fd-button-secondary"
      aria-disabled="true"
      title="Signing in works on the published app"
      v-bind="editAttrs(node, 'signInText')"
      >{{ node.props.signInText }}</span
    >
    <a v-else-if="state === 'signed-out'" class="fd-button fd-button-secondary" :href="SIGN_IN_PATH">{{ node.props.signInText }}</a>
    <p v-else-if="state === 'failed'" class="fd-account-text" role="alert">
      Couldn't check who is signed in.
      <button type="button" class="fd-button fd-button-link fd-button-small" @click="load">Try again</button>
    </p>
    <div v-else class="fd-account-panel" :aria-labelledby="`${id}-who`" role="group">
      <p :id="`${id}-who`" class="fd-account-text">
        Signed in as <strong>{{ visitor!.name || visitor!.email }}</strong>
      </p>
      <div v-if="!confirming" class="fd-account-actions">
        <button type="button" class="fd-button fd-button-secondary fd-button-small" :disabled="busy" @click="leave">Sign out</button>
        <button type="button" class="fd-button fd-button-link fd-button-small" :disabled="busy" @click="download">Download my data</button>
        <button ref="deleteButton" type="button" class="fd-button fd-button-link fd-button-small" :disabled="busy" @click="ask">Delete my account</button>
      </div>
      <div v-else class="fd-account-actions" role="alertdialog" :aria-labelledby="`${id}-confirm`">
        <p :id="`${id}-confirm`" class="fd-account-text">Delete your account? This can't be undone.</p>
        <button ref="confirmButton" type="button" class="fd-button fd-button-primary fd-button-small" :disabled="busy" @click="remove">Delete</button>
        <button type="button" class="fd-button fd-button-secondary fd-button-small" :disabled="busy" @click="keep">Keep</button>
      </div>
      <p v-if="problem" class="fd-form-error" role="alert">{{ problem }}</p>
    </div>
  </div>
</template>
