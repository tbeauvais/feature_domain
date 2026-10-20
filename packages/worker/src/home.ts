import { DEFAULT_THEME, ROOT_ID, ROOT_SLOT, themeInputs, type AppModel, type FeatureInstance, type InputValue, type Placement } from '@feature-domain/engine'
import { MODELS_API_SPEC } from './openapi'

/** The home page's model is stored under this id. The model list leaves it out; "Edit home page" opens it. */
export const HOME_ID = 'home'

/**
 * The built-in home page, built from features like any other model: an API spec on the models API feeds a form that
 * starts a model and opens it, and a table of the models, each linked to its editor, with Delete. The seed stores it
 * once, and `POST /api/v1/home/reset` puts it back.
 */
export function homeModel(): AppModel {
  const features: FeatureInstance[] = []
  // Features get the next numeric id as they are added (as the editor gives them): dependencies first, then page order.
  const add = (feature: string, inputs: Record<string, InputValue>, placement?: Placement) => {
    const id = String(features.length + 1)
    features.push(placement ? { feature, id, inputs, placement } : { feature, id, inputs })
    return id
  }
  const theme = add('ThemeFeature', { ...themeInputs(DEFAULT_THEME), name: 'Warm Editorial' })
  const api = add('SwaggerDataResourceFeature', { name: 'Models API', spec_url: '', spec: JSON.stringify(MODELS_API_SPEC), source: 'address' })
  const page = add('PageFeature', { name: 'Home', theme }, { parent: ROOT_ID, slot: ROOT_SLOT })
  const onPage: Placement = { parent: page, slot: 'content' }
  add('ImageFeature', { name: 'Banner', source: 'illustration', illustration: 'banner/blueprint', banner_height: 'short', width: '', decorative: true }, onPage)
  add('HeaderFeature', { name: 'Title', text: 'Your models', size: 1, align: 'left' }, onPage)
  add(
    'TextFeature',
    {
      name: 'Intro',
      text: 'Each model is a page built from features: a header, a table, a form, each with inputs the page is generated from. This page is one too: Edit home page changes it.',
    },
    onPage,
  )
  add(
    'FormFeature',
    {
      name: 'New model',
      title: 'Start a new model',
      data_resource: api,
      operation: 'POST /models',
      fields: ['name'],
      labels: ['Name'],
      required_fields: ['name'],
      submit_label: 'Create model',
      success_message: 'Created.',
      open_after: '/models/{id}',
    },
    onPage,
  )
  add(
    'TableFeature',
    {
      name: 'Models',
      title: 'Models',
      data_resource: api,
      operation: 'GET /models',
      delete_operation: 'DELETE /models/{id}',
      fields: ['name', 'updated_at'],
      labels: ['Model', 'Last changed'],
      filters: ['dataLink :/models/{id}', 'date'],
      scroll_rows: 12,
    },
    onPage,
  )
  return { version: 2, name: 'Home page', features }
}
