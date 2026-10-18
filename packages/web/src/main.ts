import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import './main.css'
import { createAppRouter } from './router'

createApp(App).use(createPinia()).use(createAppRouter()).mount('#app')
