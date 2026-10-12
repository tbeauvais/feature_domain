<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'
import { computed } from 'vue'
import { useEditAttrs } from '../editable'
import { safeHref } from '../urls'

const props = defineProps<{ node: DocNodeOf<'link'> }>()
const href = computed(() => safeHref(props.node.props.href))
const editAttrs = useEditAttrs()
</script>

<template>
  <!-- Only http(s) addresses become links; anything else shows the text alone (the engine warns about it). -->
  <a v-if="href" class="fd-link" :href="href" :aria-label="node.props.ariaLabel" target="_blank" rel="noopener noreferrer" v-bind="editAttrs(node, 'text')">{{ node.props.text }}</a>
  <span v-else class="fd-link" v-bind="editAttrs(node, 'text')">{{ node.props.text }}</span>
</template>
