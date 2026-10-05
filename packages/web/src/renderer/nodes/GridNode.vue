<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'

defineProps<{ node: DocNodeOf<'grid'> }>()
</script>

<template>
  <div
    class="fd-grid"
    :class="{ 'fd-well': node.props.well }"
    :style="{ gridTemplateColumns: `repeat(${node.props.columns}, minmax(0, 1fr))` }"
  >
    <slot />
  </div>
</template>
