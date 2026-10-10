<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'
import { computed } from 'vue'
import { illustrationComponents } from '../illustrations'

const props = defineProps<{ node: DocNodeOf<'separator'> }>()

const drawing = computed(() => (props.node.props.style === 'line' ? undefined : illustrationComponents[`divider/${props.node.props.style}`]))

// Sizes and the colour go in inline style (backgroundColor / color only: a stray value is ignored, never a url()).
// A line is filled with the colour; a divider illustration draws in it.
const style = computed(() =>
  drawing.value
    ? { width: `${props.node.props.width}%`, color: props.node.props.color || undefined }
    : { height: `${props.node.props.thickness}px`, width: `${props.node.props.width}%`, backgroundColor: props.node.props.color || undefined },
)
</script>

<template>
  <div v-if="drawing" role="separator" class="fd-separator fd-separator-divider" :class="`fd-separator-${node.props.align}`" :style="style">
    <component :is="drawing" />
  </div>
  <hr v-else class="fd-separator" :class="`fd-separator-${node.props.align}`" :style="style" />
</template>
