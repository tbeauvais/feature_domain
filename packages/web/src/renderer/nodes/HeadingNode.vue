<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'
import { computed } from 'vue'

const props = defineProps<{ node: DocNodeOf<'heading'> }>()

const classes = computed(() => {
  const { align, tone, background } = props.node.props
  return ['fd-heading', `fd-align-${align}`, tone && `fd-tone-${tone}`, background && `fd-bg-${background}`]
})
</script>

<template>
  <component :is="`h${node.props.level}`" :class="classes">{{ node.props.text }}</component>
</template>
