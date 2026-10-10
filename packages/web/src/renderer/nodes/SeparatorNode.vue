<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'
import { computed } from 'vue'

const props = defineProps<{ node: DocNodeOf<'separator'> }>()

// Sizes and the colour go in inline style (backgroundColor only: a stray value is ignored, never a url()).
const style = computed(() => ({
  height: `${props.node.props.thickness}px`,
  width: `${props.node.props.width}%`,
  backgroundColor: props.node.props.color || undefined,
}))
</script>

<template>
  <hr class="fd-separator" :class="`fd-separator-${node.props.align}`" :style="style" />
</template>
