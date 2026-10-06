<script setup lang="ts">
import type { InputDef, InputValue } from '@feature-domain/engine'
import { computed, ref, watch } from 'vue'

// One editor control for one feature input, chosen from the input's schema. Emits the new value, or undefined to
// clear the input (it then falls back to its default).
const props = defineProps<{ def: InputDef; value: InputValue | undefined; references?: { id: string; label: string }[] }>()
const emit = defineEmits<{ change: [value: InputValue | undefined] }>()

const id = computed(() => `input-${props.def.name}`)
const current = computed(() => props.value ?? props.def.default)
const text = computed(() => (current.value === undefined ? '' : Array.isArray(current.value) ? current.value.join('\n') : String(current.value)))
const isHexColor = computed(() => typeof current.value === 'string' && /^#[0-9a-f]{6}$/i.test(current.value))

const field = 'w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-sky-500 focus:outline-none'

// Lists and numbers are normalized before they reach the model (trimmed lines, parsed numbers), so the field keeps
// what the user is typing in a local draft. Otherwise each keystroke would round-trip and the normalized value would
// overwrite the field mid-edit (erasing a new line, or bringing back the default when the field is cleared).
const parseNumber = (raw: string): number | undefined => {
  const n = Number(raw)
  return raw.trim() === '' || !Number.isFinite(n) ? undefined : n
}
const parseList = (raw: string): string[] => raw.split('\n').map((line) => line.trim()).filter((line) => line !== '')
const parse = (raw: string): InputValue | undefined => (props.def.type === 'list' ? parseList(raw) : parseNumber(raw))
const same = (a: InputValue | undefined, b: InputValue | undefined) => JSON.stringify(a) === JSON.stringify(b)

const draft = ref(text.value)
// Adopt outside changes (another feature selected, a reset), but not the echo of our own edit.
watch(
  () => props.value,
  (value) => {
    if (!same(parse(draft.value), value)) draft.value = text.value
  },
)
function onDraft(raw: string) {
  draft.value = raw
  emit('change', parse(raw))
}
/** On leaving the field, show the value the model actually holds. */
function settle() {
  draft.value = text.value
}
</script>

<template>
  <div class="space-y-1">
    <label v-if="def.type !== 'boolean'" :for="id" class="block text-xs font-medium text-slate-600">{{ def.label }}</label>

    <select v-if="def.type === 'reference'" :id="id" :class="field" :value="text" @change="emit('change', ($event.target as HTMLSelectElement).value)">
      <option value="">None</option>
      <option v-if="text !== '' && !(references ?? []).some((r) => r.id === text)" :value="text" disabled>Missing: #{{ text }}</option>
      <option v-for="ref in references ?? []" :key="ref.id" :value="ref.id">{{ ref.label }}</option>
    </select>

    <select v-else-if="def.options" :id="id" :class="field" :value="text" @change="emit('change', ($event.target as HTMLSelectElement).value)">
      <option v-if="!def.options.some((o) => o.value === text)" :value="text" disabled>Unknown: {{ text || '(empty)' }}</option>
      <option v-for="option in def.options" :key="option.value" :value="option.value">{{ option.text }}</option>
    </select>

    <label v-else-if="def.type === 'boolean'" class="flex items-center gap-2 text-sm">
      <input :id="id" type="checkbox" :checked="current === true" @change="emit('change', ($event.target as HTMLInputElement).checked)" />
      {{ def.label }}
    </label>

    <input
      v-else-if="def.type === 'integer'"
      :id="id"
      type="number"
      :class="field"
      :min="def.min"
      :max="def.max"
      :value="draft"
      @input="onDraft(($event.target as HTMLInputElement).value)"
      @blur="settle"
    />

    <div v-else-if="def.type === 'color'" class="flex gap-2">
      <input
        :id="`${id}-swatch`"
        type="color"
        class="h-8 w-10 rounded border border-slate-300"
        :aria-label="`${def.label} swatch`"
        :value="isHexColor ? text : '#ffffff'"
        @input="emit('change', ($event.target as HTMLInputElement).value)"
      />
      <input :id="id" type="text" :class="field" placeholder="none" :value="text" @input="emit('change', ($event.target as HTMLInputElement).value)" />
    </div>

    <textarea
      v-else-if="def.type === 'list'"
      :id="id"
      rows="4"
      :class="field"
      placeholder="One item per line"
      :value="draft"
      @input="onDraft(($event.target as HTMLTextAreaElement).value)"
      @blur="settle"
    />

    <textarea
      v-else-if="def.control === 'text-area' || def.type === 'text'"
      :id="id"
      rows="3"
      :class="field"
      :value="text"
      @input="emit('change', ($event.target as HTMLTextAreaElement).value)"
    />

    <input
      v-else
      :id="id"
      type="text"
      :class="field"
      :placeholder="def.placeholder"
      :value="text"
      @input="emit('change', ($event.target as HTMLInputElement).value)"
    />
  </div>
</template>
