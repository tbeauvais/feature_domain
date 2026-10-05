<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'

defineProps<{ node: DocNodeOf<'root'> }>()
</script>

<template>
  <div class="fd-root"><slot /></div>
</template>
