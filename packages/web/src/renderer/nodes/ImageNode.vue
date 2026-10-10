<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'
import { computed } from 'vue'
import { cssSize } from '../sizes'
import { safeImageSrc } from '../urls'

const props = defineProps<{ node: DocNodeOf<'image'> }>()

// Sizes go in inline style rather than width/height attributes so no stylesheet (e.g. a CSS reset) can override them.
// Responsive images get no fixed height: like Bootstrap's img-responsive in the legacy app, their height follows the
// width (max-width: 100%; height: auto), so they keep their aspect ratio when the container is narrower.
const style = computed(() => ({
  width: cssSize(props.node.props.width),
  height: props.node.props.responsive ? undefined : cssSize(props.node.props.height),
}))
</script>

<template>
  <!-- No usable source: a quiet frame of the same size keeps the layout, so the feature still looks intended. -->
  <div
    v-if="!safeImageSrc(node.props.src)"
    class="fd-image fd-image-empty"
    :class="[`fd-image-${node.props.align}`, { 'fd-image-responsive': node.props.responsive }]"
    :style="style"
    aria-hidden="true"
  />
  <img
    v-else
    class="fd-image"
    :class="[`fd-image-${node.props.align}`, { 'fd-image-responsive': node.props.responsive }]"
    :src="safeImageSrc(node.props.src)"
    :alt="node.props.alt"
    :style="style"
  />
</template>
