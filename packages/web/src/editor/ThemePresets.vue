<script setup lang="ts">
import { deriveTokens, matchingPreset, THEME_PRESETS, type InputValue } from '@feature-domain/engine'
import { computed } from 'vue'

const props = defineProps<{ inputs: Readonly<Record<string, InputValue>> }>()
const emit = defineEmits<{ pick: [presetId: string] }>()

/** Each built-in theme drawn in its own colours, type and corners: a small page with a card, the accent and the band. */
const presets = THEME_PRESETS.map((preset) => {
  const vars = deriveTokens(preset.params).vars
  return {
    id: preset.id,
    name: preset.name,
    style: {
      '--swatch-bg': vars['--fd-bg'],
      '--swatch-ink': vars['--fd-ink'],
      '--swatch-surface': vars['--fd-surface'],
      '--swatch-border': vars['--fd-border'],
      '--swatch-accent': vars['--fd-accent-solid'],
      '--swatch-band': vars['--fd-band'],
      '--swatch-radius': vars['--fd-radius-sm'],
      '--swatch-font': vars['--fd-font-display'],
    },
  }
})
/** Marked only while every setting matches a built-in theme. */
const current = computed(() => matchingPreset(props.inputs)?.id)
</script>

<template>
  <div class="space-y-1.5" data-testid="theme-presets">
    <p id="theme-presets-label" class="text-xs font-medium text-slate-600">Start from</p>
    <div role="group" aria-labelledby="theme-presets-label" class="grid grid-cols-2 gap-2">
      <button
        v-for="preset in presets"
        :key="preset.id"
        type="button"
        class="overflow-hidden rounded-md border text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        :class="preset.id === current ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-300 hover:border-slate-400'"
        :aria-pressed="preset.id === current"
        :data-preset="preset.id"
        @click="emit('pick', preset.id)"
      >
        <span class="relative block h-12 bg-(--swatch-bg)" :style="preset.style" aria-hidden="true">
          <span class="absolute top-1.5 left-2 font-(family-name:--swatch-font) text-lg leading-none text-(--swatch-ink)">Aa</span>
          <span class="absolute top-2 right-2 size-3 rounded-full bg-(--swatch-accent)" />
          <span class="absolute top-2 right-6 size-3 rounded-full border border-(--swatch-border) bg-(--swatch-band)" />
          <span class="absolute right-2 bottom-1.5 left-2 h-2.5 rounded-(--swatch-radius) border border-(--swatch-border) bg-(--swatch-surface)" />
        </span>
        <span class="block px-2 py-1 text-xs font-medium">{{ preset.name }}</span>
      </button>
    </div>
    <p class="text-xs text-slate-500">Marked while every setting matches it. Picking one replaces all settings (⌘Z undoes).</p>
  </div>
</template>
