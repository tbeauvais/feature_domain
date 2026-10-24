<script setup lang="ts">
import type { DocNodeOf, FormField } from '@feature-domain/engine'
import { computed, inject, onBeforeUnmount, onMounted, reactive, ref, useId, watch } from 'vue'
import { NotSentFromEditor, useDataStore } from '../data'
import { fillLink } from '../filters'
import { browserOpenAddress, OPEN_ADDRESS, safeHref } from '../urls'

// A form that sends what is typed to a data resource (through the page's data store, so every table and chart on the
// resource reloads), with sending, sent and failed states. With an address to open (Then open), it opens what was
// created once sent.
const props = defineProps<{ node: DocNodeOf<'form'> }>()

const store = useDataStore()
const openAddress = inject(OPEN_ADDRESS, browserOpenAddress)
const id = useId()
// Fields get ids of their own kind, so a field named "title" doesn't take the form title's.
const fieldId = (name: string) => `fd-${id}-field-${name}`
const titleId = `fd-${id}-title`

// v-model gives numbers for number inputs (and '' when empty), true or false for a yes/no checkbox, text otherwise.
const values = reactive<Record<string, string | number | boolean>>({})
const status = ref<'idle' | 'sending' | 'sent' | 'error'>('idle')
const message = ref('')
/** Said after the success message: what the form would open (on the editor canvas), or that it had nothing to open. */
const note = ref('')
/** Set once the form has asked the browser to open an address: sending again would create a second record. */
const leaving = ref(false)
// Back to this page from the browser's cache: the page is shown as it was left, so the form can be used again.
const onPageShow = (event: PageTransitionEvent) => {
  if (event.persisted) leaving.value = false
}
onMounted(() => window.addEventListener('pageshow', onPageShow))
onBeforeUnmount(() => window.removeEventListener('pageshow', onPageShow))

const fields = computed(() => props.node.props.fields)

/** What a field starts with: its default (a choice's only when it is one of its options), else empty or no. */
function initial(field: FormField): string | number | boolean {
  if (field.type === 'yes-no') return field.default === true
  if (field.default === undefined || typeof field.default === 'boolean') return ''
  if (field.type === 'choice' && !field.options?.includes(String(field.default))) return ''
  return field.default
}
/** Every field back to what it starts with (on first showing and after sending). */
function reset() {
  for (const key of Object.keys(values)) if (!fields.value.some((f) => f.name === key)) delete values[key]
  for (const field of fields.value) values[field.name] = initial(field)
}
/** What a field takes: when it changes (a regeneration made it a text, or gave it other options), it starts over. */
const shape = (f: FormField) => JSON.stringify([f.type, f.default ?? null, f.options ?? null])
watch(
  () => fields.value.map((f) => [f.name, shape(f)] as const),
  (now, before = []) => {
    const was = new Map(before)
    for (const field of fields.value) if (!(field.name in values) || was.get(field.name) !== shape(field)) values[field.name] = initial(field)
  },
  { immediate: true },
)
const action = computed(() => props.node.props.action)
const host = computed(() => /^https?:\/\/([^/?#]+)/i.exec(action.value?.endPoint ?? '')?.[1] ?? '')

/** The typed values, numbers as numbers; empty fields left out. A problem (a required field, a non-number) in words. */
function collect(): { values: Record<string, unknown> } | { problem: string } {
  const out: Record<string, unknown> = {}
  for (const field of fields.value) {
    // A checkbox always says yes or no; it doesn't make the form count as filled in.
    if (field.type === 'yes-no') continue
    const text = String(values[field.name] ?? '').trim()
    if (text === '') {
      if (field.required) return { problem: `${field.label} is required.` }
      continue
    }
    if (field.type === 'number') {
      const n = Number(text)
      if (!Number.isFinite(n)) return { problem: `${field.label} must be a number.` }
      out[field.name] = n
    } else out[field.name] = text
  }
  // Every field empty: nothing worth sending, whatever the spec requires.
  if (Object.keys(out).length === 0 && fields.value.some((f) => f.type !== 'yes-no')) return { problem: 'Fill in the form before sending.' }
  // A checkbox is sent when it was changed from what it started at: a form changing a row (PATCH) leaves the others be.
  for (const field of fields.value)
    if (field.type === 'yes-no' && (values[field.name] === true) !== initial(field)) out[field.name] = values[field.name] === true
  return { values: out }
}

async function submit() {
  if (!action.value || status.value === 'sending' || leaving.value) return
  const collected = collect()
  if ('problem' in collected) {
    status.value = 'error'
    message.value = collected.problem
    return
  }
  status.value = 'sending'
  message.value = ''
  note.value = ''
  try {
    // A page about to be left doesn't wait for its tables to reload.
    const created = await store.send(action.value, collected.values, fields.value, { waitForReload: !(props.node.props.open && store.live) })
    status.value = 'sent'
    reset()
    if (props.node.props.open) open(props.node.props.open, created, collected.values)
  } catch (error) {
    status.value = 'error'
    if (error instanceof NotSentFromEditor) message.value = error.message
    else message.value = `${host.value ? `${host.value}: ` : ''}${error instanceof Error ? error.message : String(error)}`
  }
}

/** Opens the address, its placeholders filled from what was created, else from what was typed; the editor only says so. */
function open(template: string, created: unknown, sent: Record<string, unknown>) {
  const filled = fillLink(template, created, sent)
  const href = filled === undefined ? undefined : safeHref(filled)
  if (!href) note.value = `Nothing filled in ${template}, so it wasn't opened.`
  else if (!store.live) note.value = `In the preview, this opens ${href}.`
  else {
    leaving.value = true
    openAddress(href)
  }
}

/** The success message, then any note (the message ending as a sentence, so the two don't run together). */
const sentText = computed(() => (note.value ? `${sentence(props.node.props.success)} ${note.value}` : props.node.props.success))
const sentence = (text: string) => (/[.!?…]$/.test(text) ? text : `${text}.`)
</script>

<template>
  <form
    class="fd-form"
    :aria-labelledby="node.props.title ? titleId : undefined"
    :aria-busy="status === 'sending' ? 'true' : undefined"
    novalidate
    @submit.prevent="submit"
  >
    <p v-if="node.props.title" :id="titleId" class="fd-form-title">{{ node.props.title }}</p>
    <div v-for="field in fields" :key="field.name" class="fd-form-field" :data-fd-field="field.type === 'yes-no' ? 'check' : undefined">
      <label :for="fieldId(field.name)" class="fd-form-label">
        {{ field.label }}<span v-if="field.required" class="fd-form-required" aria-hidden="true"> *</span>
      </label>
      <textarea
        v-if="field.type === 'long-text'"
        :id="fieldId(field.name)"
        v-model="values[field.name] as string"
        class="fd-form-input fd-form-textarea"
        rows="4"
        :required="field.required"
        :aria-describedby="field.hint ? `${fieldId(field.name)}-hint` : undefined"
        :name="field.name"
      />
      <select
        v-else-if="field.type === 'choice'"
        :id="fieldId(field.name)"
        v-model="values[field.name]"
        class="fd-form-input fd-form-select"
        :required="field.required"
        :aria-describedby="field.hint ? `${fieldId(field.name)}-hint` : undefined"
        :name="field.name"
      >
        <!-- A required choice without a default asks for one; any other can be left empty. -->
        <option value="" :disabled="field.required">{{ field.required ? 'Choose…' : '—' }}</option>
        <option v-for="option in field.options" :key="option" :value="option">{{ option }}</option>
      </select>
      <input
        v-else-if="field.type === 'yes-no'"
        :id="fieldId(field.name)"
        v-model="values[field.name]"
        class="fd-form-check"
        type="checkbox"
        :aria-describedby="field.hint ? `${fieldId(field.name)}-hint` : undefined"
        :name="field.name"
      />
      <input
        v-else
        :id="fieldId(field.name)"
        v-model="values[field.name]"
        class="fd-form-input"
        :type="field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'"
        :inputmode="field.type === 'number' ? 'decimal' : undefined"
        :step="field.type === 'number' ? 'any' : undefined"
        :required="field.required"
        :aria-describedby="field.hint ? `${fieldId(field.name)}-hint` : undefined"
        :name="field.name"
      />
      <p v-if="field.hint" :id="`${fieldId(field.name)}-hint`" class="fd-form-hint">{{ field.hint }}</p>
    </div>
    <p v-if="!action" class="fd-form-note">Nothing to send to yet: choose a data resource with a POST, PUT or PATCH operation.</p>
    <div class="fd-form-actions">
      <button type="submit" class="fd-button fd-button-primary" :disabled="!action || status === 'sending' || leaving">
        {{ status === 'sending' ? 'Sending…' : node.props.submit }}
      </button>
      <!-- Always present, so screen readers announce the message when it appears. -->
      <p class="fd-form-sent" role="status">{{ status === 'sent' ? sentText : '' }}</p>
      <p v-if="status === 'error'" class="fd-form-error" role="alert">{{ message }}</p>
    </div>
  </form>
</template>
