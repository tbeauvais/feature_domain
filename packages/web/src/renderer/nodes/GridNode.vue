<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'
import { computed } from 'vue'
import { useTheme } from '../theme'

const props = defineProps<{ node: DocNodeOf<'grid'> }>()

const theme = useTheme()
// Column widths are shares of the row (fr units); without them every column is the same width.
const columns = computed(() => {
  const widths = props.node.props.widths
  return widths ? widths.map((w) => `minmax(0, ${w}fr)`).join(' ') : `repeat(${props.node.props.columns}, minmax(0, 1fr))`
})
</script>

<template>
  <div
    class="fd-grid"
    :class="{ 'fd-well': node.props.well }"
    :data-fd-well="node.props.well ? theme.styles.well : undefined"
    :style="{ gridTemplateColumns: columns }"
  >
    <slot />
  </div>
</template>
