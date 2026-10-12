<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'
import { useEditAttrs } from '../editable'

// Always plain text (never v-html).
defineProps<{ node: DocNodeOf<'paragraph'> }>()
const editAttrs = useEditAttrs()
</script>

<template>
  <p class="fd-paragraph" :class="node.props.emphasis && `fd-paragraph-${node.props.emphasis}`" v-bind="editAttrs(node, 'text')">{{ node.props.text }}</p>
</template>
