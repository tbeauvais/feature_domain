<script setup lang="ts">
import { illustrationInfo, isIllustrationId, type DocNodeOf } from '@feature-domain/engine'
import { computed } from 'vue'
import { illustrationComponents } from '../illustrations'
import { cssSize } from '../sizes'

const props = defineProps<{ node: DocNodeOf<'illustration'> }>()

const info = computed(() => illustrationInfo(props.node.props.name))
const drawing = computed(() => (isIllustrationId(props.node.props.name) && info.value?.kind !== 'divider' ? illustrationComponents[props.node.props.name] : undefined))
// The frame has the chosen shape (banners) or the illustration's own; its height follows the width.
const aspect = computed(() => props.node.props.aspect ?? info.value?.aspect)
const style = computed(() => ({ width: cssSize(props.node.props.width), aspectRatio: aspect.value ? String(aspect.value) : undefined }))
</script>

<template>
  <!-- An unknown illustration (e.g. from a newer version) shows the same quiet frame as an image without a source. -->
  <div v-if="!drawing" class="fd-image-empty fd-illustration" :class="`fd-illustration-${node.props.align}`" :style="{ width: style.width }" aria-hidden="true" />
  <div
    v-else
    class="fd-illustration"
    :class="[`fd-illustration-${info!.kind}`, `fd-illustration-${node.props.align}`]"
    :style="style"
    :role="node.props.alt ? 'img' : undefined"
    :aria-label="node.props.alt || undefined"
    :aria-hidden="node.props.alt ? undefined : 'true'"
  >
    <component :is="drawing" />
  </div>
</template>
