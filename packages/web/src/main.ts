import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import './main.css'
import { createAppRouter } from './router'
import { initBrowserModelStore } from './services'

await initBrowserModelStore()
createApp(App).use(createPinia()).use(createAppRouter()).mount('#app')
