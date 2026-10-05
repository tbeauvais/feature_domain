<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'

defineProps<{ node: DocNodeOf<'panel-body'> }>()
</script>

<template>
  <div class="fd-panel-body"><slot /></div>
</template>
