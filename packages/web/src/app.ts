import { createApp } from 'vue'
import { servePublishedApp } from './renderer/rows'
import PublishedApp from './views/PublishedApp.vue'
import './preview.css'

// A published app's page (app.html), served by the Worker on <slug>.<app domain> for every page path: the generated
// document only, with no editor styles (no Tailwind), like the preview.
servePublishedApp()
createApp(PublishedApp).mount('#app')
