import { afterAll, beforeAll } from 'vitest'
import { MemoryAppStore } from '../src/apps'
import { D1AppStore } from '../src/d1AppStore'
import { describeAppStore } from './app-store-contract'
import { localD1, type LocalD1 } from './localD1'

describeAppStore('MemoryAppStore', () => new MemoryAppStore())

let d1: LocalD1
beforeAll(async () => {
  d1 = await localD1()
}, 60_000)
afterAll(() => d1?.dispose())

describeAppStore('D1AppStore', async () => {
  await d1.env.DB.exec('DELETE FROM apps; DELETE FROM versions')
  return new D1AppStore(d1.env.DB)
})
