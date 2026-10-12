<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'
import { useEditAttrs } from '../editable'

defineProps<{ node: DocNodeOf<'list'> }>()
const editAttrs = useEditAttrs()
</script>

<template>
  <div class="fd-list" :class="[`fd-list-${node.props.align}`, `fd-list-${node.props.marker ?? 'number'}`]">
    <ul>
      <li v-for="(item, index) in node.props.items" :key="index" v-bind="editAttrs(node, 'items', index)">{{ item }}</li>
    </ul>
  </div>
</template>
