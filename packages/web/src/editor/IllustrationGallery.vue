<script setup lang="ts">
import { illustrationInfo, isIllustrationId, type InputOption } from '@feature-domain/engine'
import { computed } from 'vue'
import { illustrationComponents } from '../renderer/illustrations'

// Picks a built-in illustration. Thumbnails are the real drawings, painted with the theme of the page the feature is on
// (`vars`), so the gallery shows what the page will.
const props = defineProps<{ labelledby: string; value: string; options: InputOption[]; vars: Record<string, string> }>()
const emit = defineEmits<{ change: [value: string] }>()

const KIND_LABELS = { banner: 'Banners', spot: 'Spots', divider: 'Dividers' } as const

const groups = computed(() => {
  const out: { kind: keyof typeof KIND_LABELS; items: { id: string; name: string; aspect: number }[] }[] = []
  for (const option of props.options) {
    const info = illustrationInfo(option.value)
    if (!info || !isIllustrationId(info.id)) continue
    let group = out.find((g) => g.kind === info.kind)
    if (!group) out.push((group = { kind: info.kind, items: [] }))
    group.items.push({ id: info.id, name: option.text, aspect: info.aspect })
  }
  return out
})
const known = computed(() => props.options.some((o) => o.value === props.value))
</script>

<template>
  <div role="group" :aria-labelledby="labelledby" class="space-y-2" data-testid="illustration-gallery">
    <p v-if="!known" class="text-xs text-amber-700">Missing: {{ value || '(none)' }}. Pick one below.</p>
    <div v-for="group in groups" :key="group.kind" class="space-y-1">
      <p class="text-xs text-slate-500">{{ KIND_LABELS[group.kind] }}</p>
      <div class="grid gap-2" :class="group.kind === 'spot' ? 'grid-cols-3' : 'grid-cols-1'">
        <button
          v-for="item in group.items"
          :key="item.id"
          type="button"
          class="group flex flex-col gap-1 text-left text-xs text-slate-700"
          :aria-pressed="item.id === value"
          :data-illustration="item.id"
          @click="emit('change', item.id)"
        >
          <span
            class="relative block overflow-hidden rounded-md border [&>svg]:absolute [&>svg]:inset-0 [&>svg]:size-full"
            :class="item.id === value ? 'border-slate-900 ring-2 ring-slate-900' : 'border-slate-200 group-hover:border-slate-400'"
            :style="{ ...vars, aspectRatio: String(item.aspect) }"
          >
            <component :is="illustrationComponents[item.id as keyof typeof illustrationComponents]" />
          </span>
          {{ item.name }}
        </button>
      </div>
    </div>
  </div>
</template>
