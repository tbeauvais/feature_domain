<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'
import { computed } from 'vue'
import { safeHref } from '../urls'

const props = defineProps<{ node: DocNodeOf<'button'> }>()
const href = computed(() => safeHref(props.node.props.href))
const classes = computed(() => ['fd-button', `fd-button-${props.node.props.variant}`, `fd-button-${props.node.props.size}`])
</script>

<template>
  <div class="fd-button-row" :class="`fd-align-${node.props.align}`">
    <a v-if="href" :class="classes" :href="href" target="_blank" rel="noopener noreferrer" role="button">{{ node.props.text }}</a>
    <span v-else :class="classes" aria-disabled="true">{{ node.props.text }}</span>
  </div>
</template>
