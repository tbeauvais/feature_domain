import { MemoryModelStore } from '../src'
import { describeServerModelStore } from './store-contract'

describeServerModelStore('MemoryModelStore', () => new MemoryModelStore())
