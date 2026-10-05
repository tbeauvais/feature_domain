import { createRouter, createWebHistory } from 'vue-router'
import ModelListView from './views/ModelListView.vue'
import ModelView from './views/ModelView.vue'

export const routes = [
  { path: '/', name: 'models', component: ModelListView },
  { path: '/models/:id', name: 'model', component: ModelView, props: true },
]

export const createAppRouter = () => createRouter({ history: createWebHistory(import.meta.env.BASE_URL), routes })
