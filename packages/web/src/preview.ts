import { createPinia } from 'pinia'
import { createApp } from 'vue'
import PreviewApp from './views/PreviewApp.vue'
import './preview.css'

// The standalone preview page: the generated document only, with no editor styles (no Tailwind).
createApp(PreviewApp).use(createPinia()).mount('#app')
