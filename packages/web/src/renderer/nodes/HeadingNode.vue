<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'
import { computed } from 'vue'
import { useEditAttrs } from '../editable'

const props = defineProps<{ node: DocNodeOf<'heading'> }>()
const editAttrs = useEditAttrs()

const classes = computed(() => {
  const { align, color, background } = props.node.props
  return ['fd-heading', `fd-align-${align}`, color && `fd-color-${color}`, background && `fd-bg-${background}`]
})
</script>

<template>
  <component :is="`h${node.props.level}`" :class="classes" v-bind="editAttrs(node, 'text')">{{ node.props.text }}</component>
</template>
