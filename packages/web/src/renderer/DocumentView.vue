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

// `editing`: on the editor canvas, where forms and row deletes change sample data but never send to an address. `app`:
// a published app's page, reading the app's live rows and proxy on its own host rather than the model's.
const props = defineProps<{ root: DocNode; modelId?: string; editing?: boolean; app?: boolean }>()

// Runtime data (fetched rows, rows added to sample data) shared by every feature on the page.
provideDataStore(props.modelId ? { model: props.modelId, app: props.app } : undefined, !props.editing)
provideEditing(props.editing)
</script>

<template>
  <NodeView :node="root" />
</template>
