import { createPinia } from 'pinia'
import { createApp } from 'vue'
import PreviewApp from './views/PreviewApp.vue'

// The standalone preview page: the generated document only, with no editor styles (no Tailwind).
createApp(PreviewApp).use(createPinia()).mount('#app')
