<script setup lang="ts">
import type { DocNode } from '@feature-domain/engine'
import { provideDataStore } from './data'
import NodeView from './NodeView.vue'
// Theme fonts are bundled with the app (open-licence, self-hosted): generated pages load nothing from other sites.
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '@fontsource-variable/newsreader/opsz.css'
import './document.css'

const props = defineProps<{ root: DocNode; modelId?: string }>()

// Runtime data (fetched rows, rows added to sample data) shared by every feature on the page.
provideDataStore(props.modelId)
</script>

<template>
  <NodeView :node="root" />
</template>
