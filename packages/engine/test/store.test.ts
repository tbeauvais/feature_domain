import { MemoryModelStore } from '../src'
import { describeModelStore } from './store-contract'

describeModelStore('MemoryModelStore', () => new MemoryModelStore())
