import { createRegistry } from '../feature'
import { ContainerFeature } from './container'
import { HeaderFeature } from './header'
import { ImageFeature } from './image'
import { PageFeature } from './page'
import { TextFeature } from './text'

export { ContainerFeature, cellId } from './container'
export { HeaderFeature } from './header'
export { ImageFeature } from './image'
export { PageFeature, PAGE_CONTAINER } from './page'
export { TextFeature } from './text'

export const coreFeatures = [PageFeature, ContainerFeature, TextFeature, HeaderFeature, ImageFeature]

export const defaultRegistry = createRegistry(coreFeatures)
