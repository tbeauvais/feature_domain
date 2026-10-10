<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'

defineProps<{ node: DocNodeOf<'media'> }>()
</script>

<template>
  <div class="fd-media" :class="`fd-media-${node.props.side}`"><slot /></div>
</template>
