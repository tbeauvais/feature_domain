<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'
import { computed, inject, nextTick, onMounted, ref, useId } from 'vue'
import { linkedSignIn, looksLikeEmail, NoSignIn, readCode, sendCode, SIGNED_IN, signInWithCode, signOut, SignInError } from '../account'

/**
 * An app's sign-in form: an email, then the six-digit code emailed to it. The emailed button's link opens the app's
 * sign-in page with both filled in, and still waits for a press (a link scanner opening it uses nothing up).
 */
const props = defineProps<{ node: DocNodeOf<'sign-in'> }>()
const signedIn = inject(SIGNED_IN, () => window.location.replace('/'))

const id = useId()
const step = ref<'refused' | 'email' | 'code'>(props.node.props.refused ? 'refused' : 'email')
const email = ref('')
const code = ref('')
const busy = ref(false)
const problem = ref('')
const notice = ref('')
const codeField = ref<HTMLInputElement>()
const emailField = ref<HTMLInputElement>()

/** The emailed link's email and code, kept for after signing out someone the list leaves out. */
let linked = { email: '', code: '' }

onMounted(() => {
  linked = linkedSignIn(window.location)
  // The code stays out of the address bar (and of the history) once read.
  if (window.location.hash) history.replaceState(history.state, '', window.location.pathname + window.location.search)
  if (step.value !== 'refused') fillLinked()
})

/** Starts from the emailed link: its email, and with its code, straight at the code. */
function fillLinked() {
  if (linked.email) email.value = linked.email
  if (linked.email && linked.code) {
    code.value = linked.code
    step.value = 'code'
  }
}

const sentTo = computed(() => email.value.trim())

/** Runs one step, saying what went wrong in words. */
async function attempt(work: () => Promise<void>) {
  busy.value = true
  problem.value = ''
  try {
    await work()
  } catch (e) {
    problem.value = e instanceof SignInError ? e.message : e instanceof NoSignIn ? 'This app has no sign-in.' : 'Something went wrong. Try again.'
  } finally {
    busy.value = false
  }
}

async function ask() {
  if (!looksLikeEmail(email.value)) {
    problem.value = 'Enter your email address, such as ann@example.com.'
    return
  }
  await attempt(async () => {
    await sendCode(sentTo.value)
    code.value = ''
    step.value = 'code'
    notice.value = `If ${sentTo.value} can sign in, a code is on its way. It works for 5 minutes.`
    await nextTick()
    codeField.value?.focus()
  })
}

async function enter() {
  const digits = readCode(code.value)
  if (!digits) {
    problem.value = 'Enter the six digits from the email.'
    return
  }
  await attempt(async () => {
    await signInWithCode(sentTo.value, digits)
    signedIn()
  })
}

async function another() {
  step.value = 'email'
  code.value = ''
  problem.value = ''
  notice.value = ''
  await nextTick()
  emailField.value?.focus()
}

async function leave() {
  await attempt(async () => {
    await signOut()
    await another()
    fillLinked()
  })
}
</script>

<template>
  <section class="fd-sign-in" :aria-labelledby="`${id}-title`">
    <h1 :id="`${id}-title`" class="fd-sign-in-title">Sign in to {{ node.props.app }}</h1>

    <div v-if="step === 'refused'" class="fd-form">
      <p class="fd-sign-in-text">
        You're signed in as {{ node.props.refused }}, and {{ node.props.app }} is open only to the people it lists. Sign out to use another email.
      </p>
      <div class="fd-form-actions">
        <button type="button" class="fd-button fd-button-primary" :disabled="busy" @click="leave">Sign out</button>
        <p v-if="problem" class="fd-form-error" role="alert">{{ problem }}</p>
      </div>
    </div>

    <form v-else-if="step === 'email'" class="fd-form" novalidate @submit.prevent="ask">
      <div class="fd-form-field">
        <label :for="`${id}-email`" class="fd-form-label">Email</label>
        <input
          :id="`${id}-email`"
          ref="emailField"
          v-model="email"
          class="fd-form-input"
          type="email"
          name="email"
          autocomplete="email"
          inputmode="email"
          required
          :aria-describedby="`${id}-email-hint`"
        />
        <p :id="`${id}-email-hint`" class="fd-form-hint">We'll email you a code to sign in with. No password.</p>
      </div>
      <div class="fd-form-actions">
        <button type="submit" class="fd-button fd-button-primary" :disabled="busy">{{ busy ? 'Sending…' : 'Email me a code' }}</button>
        <p v-if="problem" class="fd-form-error" role="alert">{{ problem }}</p>
      </div>
    </form>

    <form v-else class="fd-form" novalidate @submit.prevent="enter">
      <p class="fd-sign-in-text" role="status">{{ notice || `Enter the code emailed to ${sentTo}.` }}</p>
      <div class="fd-form-field">
        <label :for="`${id}-code`" class="fd-form-label">Code</label>
        <input
          :id="`${id}-code`"
          ref="codeField"
          v-model="code"
          class="fd-form-input fd-sign-in-code"
          type="text"
          name="code"
          autocomplete="one-time-code"
          inputmode="numeric"
          maxlength="9"
          required
        />
      </div>
      <div class="fd-form-actions">
        <button type="submit" class="fd-button fd-button-primary" :disabled="busy">{{ busy ? 'Signing in…' : 'Sign in' }}</button>
        <button type="button" class="fd-button fd-button-link" :disabled="busy" @click="ask">Send a new code</button>
        <button type="button" class="fd-button fd-button-link" :disabled="busy" @click="another">Use another email</button>
        <p v-if="problem" class="fd-form-error" role="alert">{{ problem }}</p>
      </div>
    </form>

    <p class="fd-sign-in-privacy">
      Signing in keeps your email address and when you sign in. The app's owner can see them, and you can delete your account at any time.
    </p>
  </section>
</template>
