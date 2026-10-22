<script setup lang="ts">
import { formatHeight, formatWidth, NAMED_HEIGHTS, readHeight, readWidth, snapHeight, type InputDef } from '@feature-domain/engine'
import { computed } from 'vue'

// A size input: a Height (named heights as buttons beside a number field in the scale's unit) or a Width (named widths
// as buttons beside a pixel field). Typed values apply when the field is left or on Enter, normalized ("28" -> "28%");
// anything the engine can't read is passed on as typed, so generation says what is wrong with it.
const props = defineProps<{ id: string; def: InputDef; value: string }>()
const emit = defineEmits<{ change: [value: string] }>()

const height = computed(() => (props.def.heightScale ? readHeight(props.value, props.def.heightScale) : undefined))

const buttons = computed(() => {
  const scale = props.def.heightScale
  if (scale) return NAMED_HEIGHTS.map((name) => ({ value: name, text: name[0]!.toUpperCase() + name.slice(1), on: height.value?.name === name }))
  const width = props.def.widthScale ? readWidth(props.value, props.def.widthScale) : undefined
  const stored = props.value.trim() === '' ? '' : width === undefined ? undefined : formatWidth(width)
  return (props.def.options ?? []).map((o) => ({ value: o.value, text: o.text, on: o.value === stored }))
})

/** What the number field shows: the height's number (a named one's too), or the width as stored. */
const shown = computed(() => {
  const scale = props.def.heightScale
  if (!scale) return props.value
  if (!height.value) return props.value
  return String(Math.round(height.value.value * 10) / 10)
})

const unit = computed(() => (props.def.heightScale ? props.def.heightScale.unit : 'px'))

function typed(raw: string) {
  const text = raw.trim()
  const scale = props.def.heightScale
  if (scale) {
    const read = readHeight(text, scale)
    // A number that is a named height's stays a number: the field asked for one.
    emit('change', read ? formatHeight(read.name ? read : { value: snapHeight(read.value, scale) }, scale) : text)
    return
  }
  const read = props.def.widthScale && text !== '' ? readWidth(text, props.def.widthScale) : undefined
  emit('change', read === undefined ? text : formatWidth(read))
}
</script>

<template>
  <!-- Three named heights fit beside the number; a longer list of widths goes above it. -->
  <div class="flex gap-1.5" :class="buttons.length > 3 ? 'flex-col' : 'items-stretch'">
    <div v-if="buttons.length > 0" role="group" :aria-label="`${def.label} presets`" class="flex flex-1 overflow-hidden rounded-md border border-slate-300">
      <button
        v-for="b in buttons"
        :key="b.value"
        type="button"
        class="flex-1 px-1.5 py-1 text-xs whitespace-nowrap"
        :class="b.on ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'"
        :aria-pressed="b.on"
        :data-size-option="b.value || 'none'"
        @click="emit('change', b.value)"
      >
        {{ b.text }}
      </button>
    </div>
    <div class="flex items-center rounded-md border border-slate-300 focus-within:border-sky-500" :class="buttons.length > 3 ? 'w-full' : 'w-24 shrink-0'">
      <input
        :id="id"
        type="text"
        inputmode="numeric"
        class="w-full min-w-0 rounded-md px-2 py-1 text-right text-sm tabular-nums focus:outline-none"
        :placeholder="def.placeholder"
        :aria-describedby="def.hint ? `${id}-hint` : undefined"
        :value="shown"
        @change="typed(($event.target as HTMLInputElement).value)"
        @keydown.enter="($event.target as HTMLInputElement).blur()"
      />
      <span class="pr-2 text-xs text-slate-400" aria-hidden="true">{{ unit }}</span>
    </div>
  </div>
</template>
