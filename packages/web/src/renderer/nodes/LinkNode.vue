<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'
import { computed } from 'vue'
import { safeHref } from '../urls'

const props = defineProps<{ node: DocNodeOf<'link'> }>()
const href = computed(() => safeHref(props.node.props.href))
</script>

<template>
  <!-- Only http(s) addresses become links; anything else shows the text alone (the engine warns about it). -->
  <a v-if="href" class="fd-link" :href="href" target="_blank" rel="noopener noreferrer">{{ node.props.text }}</a>
  <span v-else class="fd-link">{{ node.props.text }}</span>
</template>
