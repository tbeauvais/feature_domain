<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'
import { computed } from 'vue'
import { provideTheme, useTheme } from '../theme'

const props = defineProps<{ node: DocNodeOf<'page'> }>()

// A page with a Theme carries it: its tokens as custom properties, and its style choices for the components inside.
// Without one, the page inherits the theme around it (the default).
const outer = useTheme()
const own = computed(() => props.node.props.theme)
provideTheme(computed(() => own.value ?? outer.value))
// A page's own content width overrides its theme's.
const style = computed(() => ({
  ...own.value?.vars,
  ...props.node.style,
  ...(props.node.props.contentWidth ? { '--fd-content-width': props.node.props.contentWidth } : {}),
}))
</script>

<template>
  <div class="fd-page" :style="style" :data-fd-scheme="own?.scheme">
    <slot />
  </div>
</template>
