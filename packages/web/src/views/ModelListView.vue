<script setup lang="ts">
import type { ModelSummary } from '@feature-domain/engine'
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { modelStore } from '../services'

const models = ref<ModelSummary[] | null>(null)

onMounted(async () => {
  models.value = await modelStore().list()
})
</script>

<template>
  <section>
    <h1 class="mb-4 text-2xl font-semibold">Models</h1>
    <p v-if="models === null" class="text-slate-500">Loading…</p>
    <p v-else-if="models.length === 0" class="text-slate-500">No models yet.</p>
    <ul v-else class="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white" data-testid="model-list">
      <li v-for="model in models" :key="model.id">
        <RouterLink :to="{ name: 'model', params: { id: model.id } }" class="block px-4 py-3 hover:bg-slate-50">
          {{ model.name }}
        </RouterLink>
      </li>
    </ul>
  </section>
</template>
