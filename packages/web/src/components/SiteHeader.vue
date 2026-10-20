<script setup lang="ts">
import BrandLink from './BrandLink.vue'
</script>

<!-- The site's top bar (the home page and the model list): the logo, and the page's own links on the right. -->
<template>
  <header class="border-b border-slate-200 bg-white">
    <div class="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
      <BrandLink />
      <span class="text-sm text-slate-500">Parametric application models</span>
      <nav class="ml-auto flex items-center gap-4 text-sm font-medium" aria-label="Site">
        <slot />
      </nav>
    </div>
  </header>
</template>
