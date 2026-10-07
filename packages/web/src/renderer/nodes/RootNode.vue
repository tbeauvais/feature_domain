<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'
import { computed } from 'vue'
import { DEFAULT_TOKENS, provideTheme } from '../theme'

const props = defineProps<{ node: DocNodeOf<'root'> }>()

// The document takes the theme of its first page (so the area around the pages matches), else the default.
// Pages then apply their own theme, so a second page with a different theme still renders with it.
const theme = computed(() => {
  const first = props.node.children[0]
  return (first?.kind === 'page' ? first.props.theme : undefined) ?? DEFAULT_TOKENS
})
provideTheme(theme)
</script>

<template>
  <div class="fd-root" :style="theme.vars" :data-fd-scheme="theme.scheme"><slot /></div>
</template>
