<script setup lang="ts">
import { deriveTokens, type DocNodeOf } from '@feature-domain/engine'

defineProps<{ node: DocNodeOf<'root'> }>()

// The default theme (Warm Editorial) until pages reference a Theme feature: its tokens become custom properties and
// its component styles `data-fd-*` attributes, which document.css reads.
const theme = deriveTokens()
</script>

<template>
  <div
    class="fd-root"
    :style="theme.vars"
    :data-fd-scheme="theme.scheme"
    :data-fd-panel="theme.styles.panel"
    :data-fd-table="theme.styles.table"
    :data-fd-well="theme.styles.well"
  >
    <slot />
  </div>
</template>
