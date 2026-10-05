<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'

defineProps<{ node: DocNodeOf<'panel'> }>()
</script>

<template>
  <section class="fd-panel" :class="node.props.tone && `fd-panel-${node.props.tone}`">
    <header class="fd-panel-heading">
      <h4><strong>{{ node.props.heading }}</strong></h4>
    </header>
    <slot />
  </section>
</template>
