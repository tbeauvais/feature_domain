<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'
import { useTheme } from '../theme'

defineProps<{ node: DocNodeOf<'grid'> }>()

const theme = useTheme()
</script>

<template>
  <div
    class="fd-grid"
    :class="{ 'fd-well': node.props.well }"
    :data-fd-well="node.props.well ? theme.styles.well : undefined"
    :style="{ gridTemplateColumns: `repeat(${node.props.columns}, minmax(0, 1fr))` }"
  >
    <slot />
  </div>
</template>
