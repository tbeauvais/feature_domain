<script setup lang="ts">
import { RouterView } from 'vue-router'
import ConfirmHost from './editor/ConfirmHost.vue'
</script>

<template>
  <div class="min-h-screen bg-slate-100 text-slate-900">
    <RouterView />
    <ConfirmHost />
  </div>
</template>
