<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'
import { computed } from 'vue'
import { DEFAULT_TOKENS, provideTheme } from '../theme'

defineProps<{ node: DocNodeOf<'root'> }>()

// The default theme: its tokens become custom properties here, and components below read its style choices.
const theme = computed(() => DEFAULT_TOKENS)
provideTheme(theme)
</script>

<template>
  <div class="fd-root" :style="theme.vars" :data-fd-scheme="theme.scheme"><slot /></div>
</template>
