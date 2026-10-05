import { createPinia } from 'pinia'
import { createApp } from 'vue'
import { initBrowserModelStore } from './services'
import PreviewApp from './views/PreviewApp.vue'

// The standalone preview page: the generated document only, with no editor styles (no Tailwind).
await initBrowserModelStore()
createApp(PreviewApp).use(createPinia()).mount('#app')
