<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <div class="min-h-screen bg-slate-100 text-slate-900">
    <header class="border-b border-slate-200 bg-white">
      <div class="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
        <RouterLink to="/" class="text-lg font-semibold">Feature Domain</RouterLink>
        <span class="text-sm text-slate-500">Parametric application models</span>
      </div>
    </header>
    <main class="mx-auto max-w-7xl px-4 py-6">
      <RouterView />
    </main>
  </div>
</template>
