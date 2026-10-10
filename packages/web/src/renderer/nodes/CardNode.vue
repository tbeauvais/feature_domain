<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'

defineProps<{ node: DocNodeOf<'card'> }>()
</script>

<template>
  <section class="fd-card"><slot /></section>
</template>
