<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'

defineProps<{ node: DocNodeOf<'grid-cell'> }>()
</script>

<template>
  <div class="fd-cell" :style="{ gridRow: node.props.row, gridColumn: node.props.column }"><slot /></div>
</template>
