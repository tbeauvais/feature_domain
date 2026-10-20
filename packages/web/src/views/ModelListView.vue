<script setup lang="ts">
import { RouterLink } from 'vue-router'
import ModelList from '../components/ModelList.vue'
import SiteHeader from '../components/SiteHeader.vue'
import { HOME_ID } from '../stores/apiModelStore'
</script>

<template>
  <SiteHeader>
    <RouterLink to="/" class="text-slate-700 hover:text-slate-900">Home page</RouterLink>
    <RouterLink :to="{ name: 'model', params: { id: HOME_ID } }" class="text-slate-700 hover:text-slate-900">Edit home page</RouterLink>
  </SiteHeader>
  <ModelList />
</template>
