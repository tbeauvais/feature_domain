<script setup lang="ts">
import type { DocNode } from '@feature-domain/engine'
import { provideDataStore } from './data'
import { provideEditing } from './editable'
import NodeView from './NodeView.vue'
// Theme fonts are bundled with the app (open-license, self-hosted): generated pages load nothing from other sites.
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '@fontsource-variable/newsreader/opsz.css'
import './document.css'

// `editing`: on the editor canvas, where forms and row deletes change sample data but never send to an address.
const props = defineProps<{ root: DocNode; modelId?: string; editing?: boolean }>()

// Runtime data (fetched rows, rows added to sample data) shared by every feature on the page.
provideDataStore(props.modelId, !props.editing)
provideEditing(props.editing)
</script>

<template>
  <NodeView :node="root" />
</template>
