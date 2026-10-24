<script setup lang="ts">
import { FIELD_TYPES, formatField, parseField, type FieldType, type TableField } from '@feature-domain/engine'
import { computed, reactive, ref, watch } from 'vue'

// A Database table's Fields: one card per field (name, type, a choice's options, default, required), written back as
// the lines the engine reads (`formatField`). Each change is read back with `parseField` before it reaches the model,
// so a name or default that can't be read is said beside it instead of being stored. Lines the cards can't show are
// edited as text, as is everything when asked ("Edit as text").
const props = defineProps<{ id: string; labelledby: string; value: readonly string[] }>()
const emit = defineEmits<{ change: [lines: string[]] }>()

const TYPE_LABELS: Record<FieldType, string> = { text: 'Text', 'long-text': 'Long text', number: 'Number', date: 'Date', choice: 'Choice', 'yes-no': 'Yes/no' }

const lines = computed(() => props.value.filter((line) => line.trim() !== ''))
const read = computed(() => lines.value.map((line) => parseField(line)))
const fields = computed(() => read.value.map((r) => ('field' in r ? r.field : undefined)))
const readable = computed(() => fields.value.every((f) => f !== undefined))
// Text once asked for, or once a line can't be shown as a card; it stays text while it is fixed (cards replacing the
// text box mid-word would lose what is being typed), until "Edit as fields".
const asText = ref(false)
watch(
  readable,
  (ok) => {
    if (!ok) asText.value = true
  },
  { immediate: true },
)

/** What is wrong with the last change to a field's part (`<index>:<part>`), until it is changed again. */
const problems = reactive<Record<string, string>>({})
/**
 * Bumped to draw the cards afresh (their keys), dropping what was typed but refused: when fields are added, moved or
 * removed, and when the lines change from outside (undo, another table).
 */
const drawn = ref(0)
function redraw() {
  for (const key of Object.keys(problems)) delete problems[key]
  drawn.value++
}
/** The lines last sent, to tell the model's echo of them from a change made elsewhere. */
let sent: string | undefined
function send(next: string[]) {
  sent = JSON.stringify(next)
  emit('change', next)
}
watch(lines, (now) => {
  if (JSON.stringify(now) !== sent) redraw()
  sent = undefined
})

/** A choice's options as the Fields line writes them (quoted where they hold "|", a comma or a quote). */
const optionsText = (options: readonly string[] = []) =>
  formatField({ name: 'x', type: 'choice', required: false, options: [...options] }).replace(/^x: choice /, '')

/** A problem in words, without the field name the engine puts first ("title: the default …"), capitalized. */
function reason(problem: string, name: string): string {
  const text = problem.startsWith(`${name}: `) ? problem.slice(name.length + 2) : problem
  return text[0]!.toUpperCase() + text.slice(1)
}

/** Writes field `index` as `next` if the line reads back as it; else says why beside `part`. Returns whether it did. */
function change(index: number, part: string, next: TableField): boolean {
  const key = `${index}:${part}`
  const back = parseField(formatField(next))
  if ('problem' in back) {
    problems[key] = reason(back.problem, next.name)
    return false
  }
  if (fields.value.some((f, i) => i !== index && f?.name === back.field.name)) {
    problems[key] = `Another field is called "${back.field.name}"`
    return false
  }
  delete problems[key]
  send(lines.value.map((line, i) => (i === index ? formatField(back.field) : line)))
  return true
}

const field = (index: number) => fields.value[index]!

/** Puts the field's stored value back in a control whose change was refused (the message says what was refused). */
function restore(event: Event, value: string) {
  ;(event.target as HTMLInputElement).value = value
}

function rename(index: number, event: Event) {
  if (!change(index, 'name', { ...field(index), name: (event.target as HTMLInputElement).value.trim() })) restore(event, field(index).name)
}

function retype(index: number, type: FieldType) {
  const { options: _o, default: _d, ...rest } = field(index)
  const next: TableField = { ...rest, type }
  if (type === 'choice') next.options = field(index).options ?? ['first option', 'second option']
  // The default carries over only where it still reads (a number's 3 as text "3"; not "soon" as a date).
  const kept = field(index).default
  if (kept !== undefined && typeof kept !== 'boolean' && type !== 'yes-no' && 'field' in parseField(formatField({ ...next, default: String(kept) })))
    next.default = String(kept)
  change(index, 'type', next)
}

/**
 * The options typed in a choice's box: separated by "|" (commas are part of an option there), each trimmed, a quoted
 * one as written in the Fields line (`"a | b"`), repeats and empty ones left out.
 */
function readOptions(text: string): string[] {
  const options = text.split(/\|(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((piece) => {
    const trimmed = piece.trim()
    if (!trimmed.startsWith('"')) return trimmed
    try {
      const value: unknown = JSON.parse(trimmed)
      return typeof value === 'string' ? value : trimmed
    } catch {
      return trimmed
    }
  })
  return [...new Set(options.filter((o) => o !== ''))]
}

function setOptions(index: number, event: Event) {
  const options = readOptions((event.target as HTMLInputElement).value)
  const { default: preset, ...rest } = field(index)
  const changed =
    options.length > 0 &&
    change(index, 'options', preset !== undefined && options.includes(String(preset)) ? { ...rest, options, default: preset } : { ...rest, options })
  if (options.length === 0) problems[`${index}:options`] = 'List the options, separated by |'
  if (!changed) restore(event, optionsText(field(index).options))
}

function setDefault(index: number, event: Event) {
  const text = (event.target as HTMLInputElement).value
  const { default: _d, ...rest } = field(index)
  const value = rest.type === 'yes-no' ? text === 'yes' : rest.type === 'number' && /^\s*-?[\d.]+\s*$/.test(text) ? Number(text) : text.trim()
  if (!change(index, 'default', text.trim() === '' ? rest : { ...rest, default: value })) restore(event, defaultText(field(index)))
}

const defaultText = (f: TableField) => (f.default === undefined ? '' : f.type === 'yes-no' ? (f.default ? 'yes' : 'no') : String(f.default))

function move(index: number, by: -1 | 1) {
  const next = [...lines.value]
  const [line] = next.splice(index, 1)
  next.splice(index + by, 0, line!)
  redraw()
  send(next)
}

function remove(index: number) {
  redraw()
  send(lines.value.filter((_, i) => i !== index))
}

/** Adds a text field named field_<n>, the first such name not taken. */
function add() {
  const taken = new Set(fields.value.map((f) => f?.name))
  let n = lines.value.length + 1
  while (taken.has(`field_${n}`)) n++
  redraw()
  send([...lines.value, `field_${n}: text`])
}

// The text, one field per line, kept as typed while the field has focus (like other list inputs): the model holds the
// lines trimmed, so only a change other than that replaces it.
const tidy = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
const draft = ref(lines.value.join('\n'))
watch(lines, (now) => {
  if (JSON.stringify(tidy(draft.value)) !== JSON.stringify(now)) draft.value = now.join('\n')
})
function onDraft(text: string) {
  draft.value = text
  send(tidy(text))
}
/** On leaving the text, show the lines the model holds. */
function settle() {
  draft.value = lines.value.join('\n')
}
function showFields() {
  asText.value = false
  redraw()
}

const control = 'w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-sky-500 focus:outline-none'
const small = 'rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40'
</script>

<template>
  <div :id="id" role="group" :aria-labelledby="labelledby" class="space-y-2" data-table-fields>
    <template v-if="asText">
      <p v-if="!readable" class="text-xs text-amber-700">Some lines can't be shown as fields; fix them here.</p>
      <textarea
        :aria-labelledby="labelledby"
        rows="6"
        spellcheck="false"
        :class="[control, 'font-mono text-xs leading-relaxed']"
        :value="draft"
        @input="onDraft(($event.target as HTMLTextAreaElement).value)"
        @blur="settle"
      />
      <button v-if="readable" type="button" :class="small" @click="showFields">Edit as fields</button>
    </template>

    <template v-else>
      <ol class="space-y-2">
        <li v-for="(f, i) in fields" :key="`${drawn}:${i}`" class="space-y-1.5 rounded-md border border-slate-200 bg-slate-50 p-2" :data-field="f!.name">
          <div class="flex gap-1.5">
            <input :class="control" :value="f!.name" :aria-label="`Name of field ${i + 1}`" spellcheck="false" @change="rename(i, $event)" />
            <select
              :class="[control, 'w-28 shrink-0']"
              :value="f!.type"
              :aria-label="`Type of ${f!.name}`"
              @change="retype(i, ($event.target as HTMLSelectElement).value as FieldType)"
            >
              <option v-for="type in FIELD_TYPES" :key="type" :value="type">{{ TYPE_LABELS[type] }}</option>
            </select>
          </div>
          <p v-if="problems[`${i}:name`] || problems[`${i}:type`]" class="text-xs text-red-700" role="alert">
            {{ problems[`${i}:name`] || problems[`${i}:type`] }}
          </p>

          <template v-if="f!.type === 'choice'">
            <input
              :class="control"
              :value="optionsText(f!.options)"
              :aria-label="`Options of ${f!.name}, separated by |`"
              placeholder="low | normal | high"
              @change="setOptions(i, $event)"
            />
            <p v-if="problems[`${i}:options`]" class="text-xs text-red-700" role="alert">{{ problems[`${i}:options`] }}</p>
          </template>

          <div class="flex items-center gap-1.5">
            <select
              v-if="f!.type === 'choice' || f!.type === 'yes-no'"
              :class="control"
              :value="defaultText(f!)"
              :aria-label="`Default of ${f!.name}`"
              @change="setDefault(i, $event)"
            >
              <option value="">No default</option>
              <template v-if="f!.type === 'choice'">
                <option v-for="option in f!.options" :key="option" :value="option">Default: {{ option }}</option>
              </template>
              <template v-else>
                <option value="yes">Default: yes</option>
                <option value="no">Default: no</option>
              </template>
            </select>
            <input
              v-else
              :class="control"
              :value="defaultText(f!)"
              :type="f!.type === 'date' ? 'date' : 'text'"
              :aria-label="`Default of ${f!.name}`"
              placeholder="No default"
              @change="setDefault(i, $event)"
            />
            <label class="flex shrink-0 items-center gap-1 text-xs text-slate-700">
              <input type="checkbox" :checked="f!.required" @change="change(i, 'required', { ...f!, required: ($event.target as HTMLInputElement).checked })" />
              Required
            </label>
          </div>
          <p v-if="problems[`${i}:default`]" class="text-xs text-red-700" role="alert">{{ problems[`${i}:default`] }}</p>

          <div class="flex justify-end gap-1">
            <button type="button" :class="small" :disabled="i === 0" :aria-label="`Move ${f!.name} up`" @click="move(i, -1)">↑</button>
            <button type="button" :class="small" :disabled="i === fields.length - 1" :aria-label="`Move ${f!.name} down`" @click="move(i, 1)">↓</button>
            <button type="button" :class="small" :aria-label="`Remove ${f!.name}`" @click="remove(i)">Remove</button>
          </div>
        </li>
      </ol>
      <div class="flex gap-1.5">
        <button type="button" :class="small" @click="add">Add field</button>
        <button type="button" :class="small" @click="asText = true">Edit as text</button>
      </div>
    </template>
  </div>
</template>
