import { createRegistry } from '../feature.js'
import { ContainerFeature } from './container.js'
import { DataResourceFeature } from './data-resource.js'
import { HeaderFeature } from './header.js'
import { ImageFeature } from './image.js'
import { PageFeature } from './page.js'
import { PanelFeature } from './panel.js'
import { TableFeature } from './table.js'
import { TextFeature } from './text.js'

export { ContainerFeature, cellSlot, MAX_COLUMNS } from './container.js'
export {
  DataResourceFeature,
  DATA_RESOURCE_TYPES,
  HTTP_METHODS,
  isDataResourceExports,
  pathname,
  type DataOperation,
  type DataResourceExports,
  type DataSchema,
} from './data-resource.js'
export { HeaderFeature } from './header.js'
export { ImageFeature } from './image.js'
export { PageFeature } from './page.js'
export { PanelFeature } from './panel.js'
export { TableFeature } from './table.js'
export { TextFeature } from './text.js'

export const coreFeatures = [
  PageFeature,
  ContainerFeature,
  PanelFeature,
  TextFeature,
  HeaderFeature,
  ImageFeature,
  DataResourceFeature,
  TableFeature,
]

export const defaultRegistry = createRegistry(coreFeatures)
