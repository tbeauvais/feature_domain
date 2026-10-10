<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'

// Always plain text (never v-html).
defineProps<{ node: DocNodeOf<'paragraph'> }>()
</script>

<template>
  <p class="fd-paragraph" :class="node.props.emphasis && `fd-paragraph-${node.props.emphasis}`">{{ node.props.text }}</p>
</template>
