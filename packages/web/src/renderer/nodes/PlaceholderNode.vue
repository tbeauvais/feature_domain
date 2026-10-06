<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'

// Editor-only: a feature that is on the page but produced nothing (not ported yet, or skipped by a problem).
defineProps<{ node: DocNodeOf<'placeholder'> }>()
</script>

<template>
  <div class="fd-placeholder" :class="`fd-placeholder-${node.props.status}`" :title="node.props.reason">
    <strong>{{ node.props.name || node.props.feature }}</strong>
    <span>{{ node.props.reason }}</span>
  </div>
</template>
