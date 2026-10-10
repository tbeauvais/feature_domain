<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'

defineProps<{ node: DocNodeOf<'stack'> }>()
</script>

<template>
  <div class="fd-stack"><slot /></div>
</template>
