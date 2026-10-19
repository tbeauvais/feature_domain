<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'
import { computed } from 'vue'
import { useEditAttrs } from '../editable'
import { opensNewTab, safeHref } from '../urls'

const props = defineProps<{ node: DocNodeOf<'link'> }>()
const href = computed(() => safeHref(props.node.props.href))
const editAttrs = useEditAttrs()
</script>

<template>
  <!-- Only http(s) addresses and paths on this site become links; anything else shows the text alone (the engine warns about it). -->
  <a
    v-if="href"
    class="fd-link"
    :href="href"
    :aria-label="node.props.ariaLabel"
    :target="opensNewTab(href) ? '_blank' : undefined"
    :rel="opensNewTab(href) ? 'noopener noreferrer' : undefined"
    v-bind="editAttrs(node, 'text')"
    >{{ node.props.text }}</a
  >
  <span v-else class="fd-link" v-bind="editAttrs(node, 'text')">{{ node.props.text }}</span>
</template>
