<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'

defineProps<{ node: DocNodeOf<'page'> }>()
</script>

<template>
  <div class="fd-page" :style="node.style"><slot /></div>
</template>
