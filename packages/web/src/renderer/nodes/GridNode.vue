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
// A max width keeps the container from filling the page; it sits left, centered or right. It counts the well's padding
// (border-box), so the container is as wide as its dimension says.
// A min height (padding counted too) makes it taller than its content: the rows stretch into the extra height (cards in
// them grow), unless they sit at the top or in the middle.
const box = computed(() => {
  const { maxWidth, align, minHeight, verticalAlign } = props.node.props
  const style: Record<string, string> = {}
  if (maxWidth !== undefined) {
    style.maxWidth = `${maxWidth}px`
    style.marginLeft = align === 'left' ? '0' : 'auto'
    style.marginRight = align === 'right' ? '0' : 'auto'
  }
  if (minHeight !== undefined) {
    style.minHeight = `${minHeight}px`
    if (verticalAlign) style.alignContent = verticalAlign === 'top' ? 'start' : 'center'
  }
  if (maxWidth !== undefined || minHeight !== undefined) style.boxSizing = 'border-box'
  return style
})
</script>

<template>
  <div
    class="fd-grid"
    :class="{ 'fd-well': node.props.well }"
    :data-fd-well="node.props.well ? theme.styles.well : undefined"
    :style="{ gridTemplateColumns: columns, ...box }"
  >
    <slot />
  </div>
</template>
