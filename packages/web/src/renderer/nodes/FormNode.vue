<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'
import { computed, reactive, ref, useId } from 'vue'
import { NotSentFromEditor, useDataStore } from '../data'

// A form that sends what is typed to a data resource (through the page's data store, so every table and chart on the
// resource reloads), with sending, sent and failed states.
const props = defineProps<{ node: DocNodeOf<'form'> }>()

const store = useDataStore()
const id = useId()
const fieldId = (name: string) => `fd-${id}-${name}`
const titleId = `fd-${id}-title`

// v-model gives numbers for number inputs (and '' when empty), text otherwise.
const values = reactive<Record<string, string | number>>({})
const status = ref<'idle' | 'sending' | 'sent' | 'error'>('idle')
const message = ref('')

const fields = computed(() => props.node.props.fields)
const action = computed(() => props.node.props.action)
const host = computed(() => /^https?:\/\/([^/?#]+)/i.exec(action.value?.endPoint ?? '')?.[1] ?? '')

/** The typed values, numbers as numbers; empty fields left out. A problem (a required field, a non-number) in words. */
function collect(): { values: Record<string, unknown> } | { problem: string } {
  const out: Record<string, unknown> = {}
  for (const field of fields.value) {
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
  if (Object.keys(out).length === 0 && fields.value.length > 0) return { problem: 'Fill in the form before sending.' }
  return { values: out }
}

async function submit() {
  if (!action.value || status.value === 'sending') return
  const collected = collect()
  if ('problem' in collected) {
    status.value = 'error'
    message.value = collected.problem
    return
  }
  status.value = 'sending'
  message.value = ''
  try {
    await store.send(action.value, collected.values, fields.value)
    status.value = 'sent'
    for (const key of Object.keys(values)) values[key] = ''
  } catch (error) {
    status.value = 'error'
    if (error instanceof NotSentFromEditor) message.value = error.message
    else message.value = `${host.value ? `${host.value}: ` : ''}${error instanceof Error ? error.message : String(error)}`
  }
}
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
    <div v-for="field in fields" :key="field.name" class="fd-form-field">
      <label :for="fieldId(field.name)" class="fd-form-label">
        {{ field.label }}<span v-if="field.required" class="fd-form-required" aria-hidden="true"> *</span>
      </label>
      <input
        :id="fieldId(field.name)"
        v-model="values[field.name]"
        class="fd-form-input"
        :type="field.type === 'number' ? 'number' : 'text'"
        :inputmode="field.type === 'number' ? 'decimal' : undefined"
        :step="field.type === 'number' ? 'any' : undefined"
        :required="field.required"
        :aria-describedby="field.hint ? `${fieldId(field.name)}-hint` : undefined"
        :name="field.name"
      />
      <p v-if="field.hint" :id="`${fieldId(field.name)}-hint`" class="fd-form-hint">{{ field.hint }}</p>
    </div>
    <p v-if="!action" class="fd-form-note">Nothing to send to yet: choose a data resource with a POST or PUT operation.</p>
    <div class="fd-form-actions">
      <button type="submit" class="fd-button fd-button-primary" :disabled="!action || status === 'sending'">
        {{ status === 'sending' ? 'Sending…' : node.props.submit }}
      </button>
      <!-- Always present, so screen readers announce the message when it appears. -->
      <p class="fd-form-sent" role="status">{{ status === 'sent' ? node.props.success : '' }}</p>
      <p v-if="status === 'error'" class="fd-form-error" role="alert">{{ message }}</p>
    </div>
  </form>
</template>
