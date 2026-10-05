<script setup lang="ts">
import { storeToRefs } from 'pinia'
import DocumentView from '../renderer/DocumentView.vue'
import { useDocumentStore } from '../stores/document'

const store = useDocumentStore()
const { status, error, result, generateError } = storeToRefs(store)

const id = new URLSearchParams(window.location.search).get('model')
if (id) store.load(id)
</script>

<template>
  <DocumentView v-if="status === 'ready' && result" :root="result.root" />
  <p v-else-if="!id">No model selected.</p>
  <p v-else-if="status === 'missing'">This model does not exist.</p>
  <p v-else-if="status === 'error'">Could not load the model: {{ error }}</p>
  <p v-else-if="generateError">Could not generate the model: {{ generateError }}</p>
  <p v-else>Loading…</p>
</template>
