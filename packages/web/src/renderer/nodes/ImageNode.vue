<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'
import { computed } from 'vue'
import { safeImageSrc } from '../urls'

const props = defineProps<{ node: DocNodeOf<'image'> }>()

/** Legacy sizes were HTML attributes ("300", "100%"); as CSS a bare number means pixels. */
function cssSize(value: string): string | undefined {
  if (value.trim() === '') return undefined
  return /^\d+(\.\d+)?$/.test(value.trim()) ? `${value.trim()}px` : value.trim()
}

// Sizes go in inline style rather than width/height attributes so no stylesheet (e.g. a CSS reset) can override them.
// Responsive images get no fixed height: like Bootstrap's img-responsive in the legacy app, their height follows the
// width (max-width: 100%; height: auto), so they keep their aspect ratio when the container is narrower.
const style = computed(() => ({
  width: cssSize(props.node.props.width),
  height: props.node.props.responsive ? undefined : cssSize(props.node.props.height),
}))
</script>

<template>
  <img
    class="fd-image"
    :class="[`fd-image-${node.props.align}`, { 'fd-image-responsive': node.props.responsive }]"
    :src="safeImageSrc(node.props.src)"
    :alt="node.props.alt"
    :style="style"
  />
</template>
