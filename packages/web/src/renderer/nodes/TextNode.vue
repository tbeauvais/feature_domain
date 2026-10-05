<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'

// Always plain text: Vue escapes interpolation, so legacy HTML or {{...}} bindings show literally (never executed).
defineProps<{ node: DocNodeOf<'text'> }>()
</script>

<template>
  <span class="fd-text">{{ node.props.text }}</span>
</template>
