import { createRegistry } from '../feature.js'
import { ButtonFeature } from './button.js'
import { ContainerFeature } from './container.js'
import { DataResourceFeature } from './data-resource.js'
import { HeaderFeature } from './header.js'
import { ImageFeature } from './image.js'
import { LinkFeature } from './link.js'
import { ListFeature } from './list.js'
import { PageFeature } from './page.js'
import { PanelFeature } from './panel.js'
import { SeparatorFeature } from './separator.js'
import { TableFeature } from './table.js'
import { TextFeature } from './text.js'
import { ThemeFeature } from './theme.js'

export { ButtonFeature } from './button.js'
export { ContainerFeature, cellSlot, MAX_COLUMNS, MAX_ROWS } from './container.js'
export {
  DataResourceFeature,
  DATA_RESOURCE_TYPES,
  HTTP_METHODS,
  httpMethod,
  isDataResourceExports,
  operationName,
  pathname,
  type DataOperation,
  type DataResourceExports,
  type DataSchema,
} from './data-resource.js'
export { HeaderFeature } from './header.js'
export { ImageFeature } from './image.js'
export { LinkFeature } from './link.js'
export { ListFeature } from './list.js'
export { PageFeature } from './page.js'
export { PanelFeature } from './panel.js'
export { SeparatorFeature } from './separator.js'
export { TableFeature } from './table.js'
export { TextFeature } from './text.js'
export { isThemeExports, ThemeFeature, type ThemeExports } from './theme.js'

export const coreFeatures = [
  PageFeature,
  ContainerFeature,
  PanelFeature,
  TextFeature,
  HeaderFeature,
  ImageFeature,
  ListFeature,
  SeparatorFeature,
  LinkFeature,
  ButtonFeature,
  DataResourceFeature,
  TableFeature,
  ThemeFeature,
]

export const defaultRegistry = createRegistry(coreFeatures)
