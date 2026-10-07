<script setup lang="ts">
import { ROOT_ID, ROOT_SLOT, type ModelSummary } from '@feature-domain/engine'
import { onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import BrandLink from '../components/BrandLink.vue'
import { modelStore } from '../services'

const models = ref<ModelSummary[] | null>(null)
const router = useRouter()

/** A new model starts with one empty page. */
async function createModel() {
  const id = await modelStore().create({
    version: 2,
    name: 'Untitled model',
    features: [{ feature: 'PageFeature', id: '1', inputs: { name: 'Page' }, placement: { parent: ROOT_ID, slot: ROOT_SLOT } }],
  })
  await router.push({ name: 'model', params: { id } })
}

onMounted(async () => {
  models.value = await modelStore().list()
})
</script>

<template>
  <header class="border-b border-slate-200 bg-white">
    <div class="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
      <BrandLink />
      <span class="text-sm text-slate-500">Parametric application models</span>
    </div>
  </header>
  <section class="mx-auto max-w-7xl px-4 py-6">
    <div class="mb-4 flex items-center justify-between">
      <h1 class="text-2xl font-semibold">Models</h1>
      <button type="button" class="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700" data-testid="new-model" @click="createModel">
        New model
      </button>
    </div>
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
