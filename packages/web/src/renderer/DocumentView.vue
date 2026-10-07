<script setup lang="ts">
import type { DocNode } from '@feature-domain/engine'
import NodeView from './NodeView.vue'
// Theme fonts are bundled with the app (open-licence, self-hosted): generated pages load nothing from other sites.
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '@fontsource-variable/newsreader/opsz.css'
import './document.css'

defineProps<{ root: DocNode }>()
</script>

<template>
  <NodeView :node="root" />
</template>
