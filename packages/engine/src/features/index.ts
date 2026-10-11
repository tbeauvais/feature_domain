import { createRegistry } from '../feature.js'
import { ApiSpecFeature } from './api-spec.js'
import { ButtonFeature } from './button.js'
import { ContainerFeature } from './container.js'
import { DataResourceFeature } from './data-resource.js'
import { HeaderFeature } from './header.js'
import { ImageFeature } from './image.js'
import { ImageWithParagraphFeature } from './image-with-paragraph.js'
import { LinkFeature } from './link.js'
import { ListGroupFeature } from './list-group.js'
import { ListFeature } from './list.js'
import { PageFeature } from './page.js'
import { PanelFeature } from './panel.js'
import { SeparatorFeature } from './separator.js'
import { TableFeature } from './table.js'
import { TextFeature } from './text.js'
import { TextWithParagraphFeature } from './text-with-paragraph.js'
import { ThemeFeature } from './theme.js'

export { ApiSpecFeature, MAX_SPEC_CHARS, MAX_SPEC_OPERATIONS, readApiSpec, type ReadSpec } from './api-spec.js'
export { ButtonFeature } from './button.js'
export { ContainerFeature, cellSlot, MAX_COLUMNS, MAX_ROWS } from './container.js'
export {
  DataResourceFeature,
  DATA_RESOURCE_TYPES,
  HTTP_METHODS,
  httpMethod,
  isDataResourceExports,
  MAX_SAMPLE_ROWS,
  parseSampleRows,
  SAMPLE_OPERATIONS,
  operationName,
  pathname,
  type DataOperation,
  type DataParameter,
  type DataResourceExports,
  type DataSchema,
} from './data-resource.js'
export { HeaderFeature } from './header.js'
export { ImageFeature } from './image.js'
export { ImageWithParagraphFeature } from './image-with-paragraph.js'
export { LinkFeature } from './link.js'
export { ListGroupFeature } from './list-group.js'
export { ListFeature } from './list.js'
export { PageFeature } from './page.js'
export { PanelFeature } from './panel.js'
export { SeparatorFeature } from './separator.js'
export { columnsFromRows, TableFeature } from './table.js'
export { TextFeature } from './text.js'
export { TextWithParagraphFeature } from './text-with-paragraph.js'
export { isThemeExports, matchingPreset, ThemeFeature, themeInputs, themeParams, type ThemeExports } from './theme.js'

export const coreFeatures = [
  PageFeature,
  ContainerFeature,
  PanelFeature,
  TextFeature,
  HeaderFeature,
  ImageFeature,
  ListFeature,
  TextWithParagraphFeature,
  ImageWithParagraphFeature,
  ListGroupFeature,
  SeparatorFeature,
  LinkFeature,
  ButtonFeature,
  DataResourceFeature,
  ApiSpecFeature,
  TableFeature,
  ThemeFeature,
]

export const defaultRegistry = createRegistry(coreFeatures)
