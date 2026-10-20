<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import ModelList from '../components/ModelList.vue'
import SiteHeader from '../components/SiteHeader.vue'
import { modelStore } from '../services'
import { HOME_ID } from '../stores/apiModelStore'

// Edit home page leads nowhere when there is no home model (the home page then offers to reset it), so it is offered
// only once the home model is known to exist.
const hasHome = ref(false)
onMounted(async () => {
  try {
    hasHome.value = !!(await modelStore().get(HOME_ID))
  } catch {
    // Can't tell; the list shows its own load error.
  }
})
</script>

<template>
  <SiteHeader>
    <RouterLink to="/" class="text-slate-700 hover:text-slate-900">Home page</RouterLink>
    <RouterLink v-if="hasHome" :to="{ name: 'model', params: { id: HOME_ID } }" class="text-slate-700 hover:text-slate-900">Edit home page</RouterLink>
  </SiteHeader>
  <ModelList />
</template>
