<script setup lang="ts">
import type { DocNode } from '@feature-domain/engine'
import NodeView from './NodeView.vue'
import './document.css'

defineProps<{ root: DocNode }>()
</script>

<template>
  <NodeView :node="root" />
</template>
