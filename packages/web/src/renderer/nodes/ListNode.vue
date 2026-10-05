<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'

defineProps<{ node: DocNodeOf<'list'> }>()
</script>

<template>
  <div class="fd-list" :class="`fd-list-${node.props.align}`">
    <ul>
      <li v-for="(item, index) in node.props.items" :key="index">{{ item }}</li>
    </ul>
  </div>
</template>
