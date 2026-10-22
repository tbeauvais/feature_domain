<script setup lang="ts">
import type { InputDef, InputValue } from '@feature-domain/engine'
import { computed, ref, watch } from 'vue'
import ApiSpecField from './ApiSpecField.vue'
import { canonicalWidths, columnPresets } from './columnPresets'
import IllustrationGallery from './IllustrationGallery.vue'
import PlaceSearchField from './PlaceSearchField.vue'
import SizeField from './SizeField.vue'

// One editor control for one feature input, chosen from the input's schema. Emits the new value, or undefined to
// clear the input (it then falls back to its default).
const props = defineProps<{
  def: InputDef
  value: InputValue | undefined
  /** The feature's other inputs, for controls that need them (the API spec's Load spec reads its Spec URL). */
  inputs?: Readonly<Record<string, InputValue>>
  references?: { id: string; label: string }[]
  /** Theme custom properties for previews (the illustration gallery). */
  themeVars?: Record<string, string>
}>()
// `changeInputs`: controls that set several inputs at once (the Weather's Location sets its coordinates too).
const emit = defineEmits<{ change: [value: InputValue | undefined]; changeInputs: [values: Record<string, InputValue>] }>()

const id = computed(() => `input-${props.def.name}`)
const current = computed(() => props.value ?? props.def.default)
const text = computed(() => (current.value === undefined ? '' : Array.isArray(current.value) ? current.value.join('\n') : String(current.value)))
// The swatch needs #rrggbb; short #rgb values (which themes accept) are expanded for it.
const swatch = computed(() => {
  const value = typeof current.value === 'string' ? current.value.trim() : ''
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(value)) return `#${[...value.slice(1)].map((ch) => ch + ch).join('')}`.toLowerCase()
  return '#ffffff'
})

/** Controls made of several buttons are labeled as a group rather than through `for`. */
const grouped = computed(
  () =>
    ((props.def.control === 'segmented' || props.def.control === 'illustration-gallery') && props.def.options !== undefined) ||
    props.def.control === 'api-spec' ||
    props.def.control === 'place-search',
)

const field = 'w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-sky-500 focus:outline-none'

// Lists and numbers are normalized before they reach the model (trimmed lines, parsed numbers), so the field keeps
// what the user is typing in a local draft. Otherwise each keystroke would round-trip and the normalized value would
// overwrite the field mid-edit (erasing a new line, or bringing back the default when the field is cleared).
const parseNumber = (raw: string): number | undefined => {
  const n = Number(raw)
  return raw.trim() === '' || !Number.isFinite(n) ? undefined : n
}
const parseList = (raw: string): string[] =>
  raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
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
// A Container's Column widths: the presets for its number of columns, and which one the stored widths are.
const presets = computed(() => (props.def.control === 'column-widths' ? columnPresets(props.inputs?.columns) : []))
const canonical = computed(() => (props.def.control === 'column-widths' ? canonicalWidths(current.value, props.inputs?.columns) : undefined))

/** On leaving the field, show the value the model actually holds. */
function settle() {
  draft.value = text.value
}
</script>

<template>
  <div class="space-y-1">
    <span v-if="grouped" :id="`${id}-label`" class="block text-xs font-medium text-slate-600">{{ def.label }}</span>
    <label v-else-if="def.type !== 'boolean'" :for="id" class="block text-xs font-medium text-slate-600">{{ def.label }}</label>

    <p v-if="grouped && def.control === 'segmented' && !def.options!.some((o) => o.value === text)" class="text-xs text-amber-700">
      Missing: {{ text || '(none)' }}. Pick one below.
    </p>
    <div
      v-if="grouped && def.control === 'segmented'"
      role="group"
      :aria-labelledby="`${id}-label`"
      class="flex overflow-hidden rounded-md border border-slate-300"
    >
      <button
        v-for="option in def.options"
        :key="option.value"
        type="button"
        class="flex-1 px-2 py-1 text-sm"
        :class="option.value === text ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'"
        :aria-pressed="option.value === text"
        @click="emit('change', option.value)"
      >
        {{ option.text }}
      </button>
    </div>

    <IllustrationGallery
      v-else-if="grouped && def.control === 'illustration-gallery'"
      :labelledby="`${id}-label`"
      :value="text"
      :options="def.options ?? []"
      :vars="themeVars ?? {}"
      @change="emit('change', $event)"
    />

    <!-- Heights and widths: named sizes as buttons, and the number typed (applied on leaving the field). -->
    <SizeField v-else-if="def.control === 'height' || def.control === 'pixels'" :id="id" :def="def" :value="text" @change="emit('change', $event)" />

    <select v-else-if="def.type === 'reference'" :id="id" :class="field" :value="text" @change="emit('change', ($event.target as HTMLSelectElement).value)">
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
        :value="swatch"
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

    <ApiSpecField
      v-else-if="def.control === 'api-spec'"
      :id="id"
      :labelledby="`${id}-label`"
      :value="text"
      :spec-url="typeof inputs?.spec_url === 'string' ? inputs.spec_url : ''"
      :via-server="inputs?.fetch_through === 'server'"
      @change="emit('change', $event)"
    />

    <PlaceSearchField
      v-else-if="def.control === 'place-search'"
      :id="id"
      :labelledby="`${id}-label`"
      :value="text"
      :latitude="typeof inputs?.latitude === 'string' ? inputs.latitude : ''"
      :longitude="typeof inputs?.longitude === 'string' ? inputs.longitude : ''"
      @pick="emit('changeInputs', { [def.name]: $event.name, latitude: $event.latitude, longitude: $event.longitude })"
    />

    <!-- JSON (e.g. sample rows): taller, monospace, and no spell-checking. -->
    <textarea
      v-else-if="def.control === 'json-area'"
      :id="id"
      rows="12"
      spellcheck="false"
      :class="[field, 'font-mono text-xs leading-relaxed']"
      :value="text"
      @input="emit('change', ($event.target as HTMLTextAreaElement).value)"
    />

    <textarea
      v-else-if="def.control === 'text-area' || def.type === 'text'"
      :id="id"
      rows="3"
      :class="field"
      :value="text"
      @input="emit('change', ($event.target as HTMLTextAreaElement).value)"
    />

    <!-- Column widths: common layouts as buttons, and the shares typed (applied on leaving the field). -->
    <template v-else-if="def.control === 'column-widths'">
      <div v-if="presets.length > 0" role="group" :aria-label="`${def.label} presets`" class="flex flex-wrap gap-1">
        <button
          v-for="preset in presets"
          :key="preset.value"
          type="button"
          class="rounded-md border px-2 py-0.5 text-xs"
          :class="preset.value === canonical ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'"
          :aria-pressed="preset.value === canonical"
          :data-preset="preset.value || 'equal'"
          @click="emit('change', preset.value)"
        >
          {{ preset.text }}
        </button>
      </div>
      <input
        :id="id"
        type="text"
        :class="field"
        :placeholder="def.placeholder"
        :aria-describedby="def.hint ? `${id}-hint` : undefined"
        :value="text"
        @change="emit('change', ($event.target as HTMLInputElement).value)"
      />
    </template>

    <!-- Committed on leaving the field (the change event) when each value would cost a request. -->
    <input
      v-else-if="def.commitOnBlur"
      :id="id"
      type="text"
      :class="field"
      :placeholder="def.placeholder"
      :aria-describedby="def.hint ? `${id}-hint` : undefined"
      :value="text"
      @change="emit('change', ($event.target as HTMLInputElement).value)"
    />

    <input
      v-else
      :id="id"
      type="text"
      :class="field"
      :placeholder="def.placeholder"
      :aria-describedby="def.hint ? `${id}-hint` : undefined"
      :value="text"
      @input="emit('change', ($event.target as HTMLInputElement).value)"
    />
    <p v-if="def.hint" :id="`${id}-hint`" class="text-xs text-slate-500">{{ def.hint }}</p>
  </div>
</template>
