<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'
import { useTheme } from '../theme'

defineProps<{ node: DocNodeOf<'panel'> }>()

const theme = useTheme()
</script>

<template>
  <section class="fd-panel" :data-fd-panel="theme.styles.panel" :data-fd-emphasis="node.props.emphasis">
    <header class="fd-panel-heading">
      <h4><strong>{{ node.props.heading }}</strong></h4>
    </header>
    <slot />
  </section>
</template>
