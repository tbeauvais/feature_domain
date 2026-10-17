import { createApp } from './app'
import type { Env } from './env'

export default createApp() satisfies ExportedHandler<Env>
