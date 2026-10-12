import { defaultRegistry, migrate, nextInstanceId, normalizeOrder, referencedIds, type AppModel, type FeatureInstance, type IllustrationId } from '@feature-domain/engine'
import { SAMPLE_MODELS } from './sampleModels'

// The samples. Browsers are seeded with the ones written for this app (set 2). Browsers seeded earlier with the legacy
// samples (migrated from app_models/ and sample.json, which stay as the engine's migration fixtures) keep them, brought
// up to date by `upgradeSample`, and get set 2 added.

/** The set of samples new browsers get (`BrowserModelStore.addSampleSet` adds it to browsers seeded with set 1). */
export const SAMPLE_SET = 2

/**
 * Bumped whenever `upgradeSample` changes, so browsers that seeded older samples get the change once
 * (`BrowserModelStore.upgradeSeeded`). 2: stock header photos became built-in banners. 3: those banners are short.
 * 4: the GitHub repo tables show languages as badges, names as they are, and scroll after 10 rows. 5: their date column
 * is labeled "Updated", and Getting Started's headline loses its stray keystrokes. 6: the Sales API (its server is gone)
 * answers with sample sales. 7: its sales chart is titled and drawn as columns (better for comparing people than a pie).
 * 8: its Add Sale form requires a name and an amount (the spec requires neither). 9: its amounts show as dollars.
 * 10: the weather texts reading Yahoo's dead service become Weather cards, and the Yahoo resources go.
 * 11: Data Sample says live how many public repos and followers Tom has, above his repo table.
 * 12: samples are put in dependency order (Getting Started listed a map before the container it is in).
 */
export const SAMPLES_VERSION = 12

/** The samples' GitHub repo tables, exactly as migrated, and what they become. */
const LEGACY_REPO_TABLE = { fields: ['name', 'description', 'language', 'updated_at'], filters: ['uppercase', 'dataLink :data.html_url', '', 'date'] }
const REPO_TABLE_FILTERS = ['', 'dataLink :data.html_url', 'badge', 'date']
const LEGACY_REPO_LABELS = ['Name', 'Description', 'Language', 'Updated At']
const REPO_TABLE_LABELS = ['Name', 'Description', 'Language', 'Updated']

/** The Swagger sample's API, whose server (sales-api.mybluemix.net) is gone, and the sales it answers with instead. */
const SALES_SPEC_URL = 'http://sales-api.mybluemix.net/swagger_doc/sales.json'
const SAMPLE_SALES = [
  { id: '1', name: 'Avery Chen', amount: 18250 },
  { id: '2', name: 'Jordan Patel', amount: 12900 },
  { id: '3', name: 'Sam Rivera', amount: 9600 },
  { id: '4', name: 'Morgan Lee', amount: 7400 },
  { id: '5', name: 'Riley Brooks', amount: 4300 },
]

/**
 * The samples' weather texts, which bound to Yahoo's weather service (shut down in 2019), and the Weather card each
 * becomes: the place of the map beside it.
 */
const yahooText = (resource: string) =>
  `Temp {{DataResource.${resource}.query.results.channel.item.condition.temp}} degrees. {{DataResource.${resource}.query.results.channel.item.condition.text}}`
const GUILFORD = { place: 'Guilford, Connecticut', latitude: '41.2890', longitude: '-72.6818' }
const PALM_BEACH = { place: 'Palm Beach, Florida', latitude: '26.7056', longitude: '-80.0364' }
/** As stored before data values in text: the bindings as written. */
const LEGACY_WEATHER_TEXTS: Readonly<Record<string, Record<string, string>>> = { [yahooText('WeatherService')]: GUILFORD, [yahooText('WeatherServiceFL')]: PALM_BEACH }
/** As migrated since: values of the Yahoo resource the text reads, whose Yahoo place id (woeid) says where. */
const MIGRATED_WEATHER_TEXT = 'Temp {{query.results.channel.item.condition.temp}} degrees. {{query.results.channel.item.condition.text}}'
const WEATHER_PLACES: Readonly<Record<string, Record<string, string>>> = { '2415484': GUILFORD, '91560673': PALM_BEACH }
const YAHOO_WEATHER = 'https://query.yahooapis.com/v1/public/yql?q=select%20item.condition%20from%20weather.forecast'
const isYahooWeather = (f: FeatureInstance) => f.feature === 'DataResourceFeature' && typeof f.inputs.resource === 'string' && f.inputs.resource.startsWith(YAHOO_WEATHER)

/** The Weather card a sample's weather text becomes, if it is one. */
function weatherPlace(text: FeatureInstance, features: readonly FeatureInstance[]): Record<string, string> | undefined {
  const value = text.inputs.text
  if (typeof value !== 'string') return undefined
  if (Object.hasOwn(LEGACY_WEATHER_TEXTS, value)) return LEGACY_WEATHER_TEXTS[value]
  if (value !== MIGRATED_WEATHER_TEXT) return undefined
  const resource = features.find((f) => f?.id === text.inputs.data_resource)
  if (!resource || typeof resource.inputs !== 'object' || resource.inputs === null || !isYahooWeather(resource)) return undefined
  const woeid = /woeid%20%3D%20(\d+)/.exec(String(resource.inputs.resource))?.[1]
  return woeid !== undefined && Object.hasOwn(WEATHER_PLACES, woeid) ? WEATHER_PLACES[woeid] : undefined
}

/** Data Sample's repos of Tom's, and his GitHub profile, which a text above the repo table reads values from. */
const TOMS_REPOS = 'https://api.github.com/users/tbeauvais/repos?per_page=5'
const TOMS_PROFILE = 'https://api.github.com/users/tbeauvais'
const PROFILE_TEXT = 'Tom has {{public_repos}} public repos and {{followers}} followers on GitHub.'

/**
 * A sample with Tom's repo table but not yet his profile gets the profile as a data resource and a text reading it,
 * placed just before the panel holding the table.
 */
function withProfileText(model: AppModel): AppModel {
  const features = model.features
  const isResource = (f: FeatureInstance, url: string) => f?.feature === 'DataResourceFeature' && typeof f.inputs === 'object' && f.inputs !== null && f.inputs.resource === url
  const repos = features.find((f) => isResource(f, TOMS_REPOS))
  if (!repos || features.some((f) => isResource(f, TOMS_PROFILE))) return model
  const table = features.find((f) => f?.feature === 'TableFeature' && f.inputs?.data_resource === repos.id)
  const panel = table?.placement && features.find((f) => f?.id === table.placement!.parent && f.feature === 'PanelFeature')
  if (!panel?.placement) return model
  const profileId = nextInstanceId(model)
  const profile: FeatureInstance = { feature: 'DataResourceFeature', id: profileId, inputs: { name: "Tom's Profile", resource: TOMS_PROFILE, operation: 'GET' } }
  const text: FeatureInstance = {
    feature: 'TextFeature',
    id: String(Number(profileId) + 1),
    inputs: { name: 'Repo count', text: PROFILE_TEXT, data_resource: profileId },
    placement: { ...panel.placement },
  }
  const at = features.indexOf(panel)
  return { ...model, features: [...features.slice(0, at), profile, text, ...features.slice(at)] }
}

/** Sample texts with typos from the legacy samples, and their fixes. */
const TEXT_FIXES: Readonly<Record<string, string>> = { 'Here is some content for ya...gfdgfd': 'Here is some content for ya...' }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** The samples' header photos (stock images from other sites, mostly gone) and the banner that replaces each. */
const LEGACY_HEADERS: Readonly<Record<string, IllustrationId>> = {
  'http://www.baybridgecompanies.com/clipart/pageHeaders/blue_header.jpg': 'banner/blueprint',
  'https://www.nard.ma/images/english/web-application-header.jpg': 'banner/shapes',
}

/**
 * A sample brought up to date. Returns the same object when nothing changes.
 * - Repo tables still exactly as migrated show languages as badges and names as they are, and scroll after 10 rows.
 * - Repo tables still labeled as migrated label their date column "Updated".
 * - Headers with a known typo from the legacy samples are fixed.
 * - The Sales API, still answering from its dead server, answers with sample sales instead.
 * - The Sales chart, still the untitled pie the legacy sample had, gets a title and is drawn as columns.
 * - Image features still showing one of the legacy header photos as a link show the matching banner instead, full
 *   width and short (the photos were 150px tall), described by its own alt text. The address stays, so switching
 *   Source back to Link restores it.
 * - Text features still exactly the samples' Yahoo weather texts (as written, or as migrated to values) become Weather cards for the place beside them, in the
 *   same place on the page; data resources reading Yahoo's weather that nothing references are removed.
 * - A sample with Tom's repo table gets his GitHub profile and a text reading values from it, above the table.
 * - Features listed before what they depend on are moved after it, without changing the page.
 */
export function upgradeSample(stored: AppModel): AppModel {
  if (!Array.isArray(stored.features)) return stored
  // Features ported since the sample was stored are migrated first (the editor would on load anyway), so the changes
  // below see their current inputs. The same object comes back when there is nothing to migrate.
  let model = stored
  try {
    model = migrate(stored).model
  } catch {
    return stored
  }
  let changed = false
  const upgraded = model.features.map((f) => {
    if (typeof f?.inputs !== 'object' || f.inputs === null) return f
    if (f.feature === 'TextFeature') {
      const place = weatherPlace(f, model.features)
      if (!place) return f
      changed = true
      const weather: FeatureInstance = { feature: 'WeatherFeature', id: f.id, inputs: { name: 'Weather', ...place, units: 'fahrenheit', show: 'forecast' } }
      if (f.inputs.disable === true) weather.inputs.disable = true
      if (f.placement) weather.placement = f.placement
      return weather
    }
    if (f.feature === 'TableFeature') {
      let inputs = f.inputs
      if (same(inputs.fields, LEGACY_REPO_TABLE.fields) && same(inputs.filters, LEGACY_REPO_TABLE.filters)) {
        inputs = { ...inputs, filters: REPO_TABLE_FILTERS, scroll_rows: inputs.scroll_rows ?? 10 }
      }
      if (same(inputs.fields, LEGACY_REPO_TABLE.fields) && same(inputs.labels, LEGACY_REPO_LABELS)) inputs = { ...inputs, labels: REPO_TABLE_LABELS }
      // The Sales table's amounts are dollars (its columns come from the spec, so the filter goes by position).
      if (inputs.name === 'Sales Table' && inputs.operation === 'GET /v1/sales' && same(inputs.filters, [])) inputs = { ...inputs, filters: ['', '', 'currency'] }
      if (inputs === f.inputs) return f
      changed = true
      return { ...f, inputs }
    }
    if (f.feature === 'SwaggerDataResourceFeature') {
      if (f.inputs.spec_url !== SALES_SPEC_URL || (f.inputs.source !== undefined && f.inputs.source !== 'address')) return f
      changed = true
      return { ...f, inputs: { ...f.inputs, source: 'sample', sample_rows: JSON.stringify(SAMPLE_SALES, null, 2) } }
    }
    if (f.feature === 'FormFeature') {
      const legacy = f.inputs.name === 'Add Sale' && f.inputs.operation === 'POST /v1/sales' && f.inputs.required_fields === undefined
      if (!legacy) return f
      changed = true
      return { ...f, inputs: { ...f.inputs, required_fields: ['name', 'amount'] } }
    }
    if (f.feature === 'GoogleChartFeature') {
      let inputs = f.inputs
      const sales = inputs.name === 'Sales Chart' && inputs.value_field === 'amount'
      if (sales && inputs.chart_type === 'pie' && !inputs.title) inputs = { ...inputs, title: 'Sales by person', chart_type: 'column' }
      // Only the sample's own chart (titled by the step above), not a sales chart of the user's.
      if (sales && inputs.title === 'Sales by person' && inputs.value_format === undefined) inputs = { ...inputs, value_format: 'currency' }
      if (inputs === f.inputs) return f
      changed = true
      return { ...f, inputs }
    }
    if (f.feature === 'HeaderFeature') {
      const text = f.inputs.text
      if (typeof text !== 'string' || !Object.hasOwn(TEXT_FIXES, text)) return f
      changed = true
      return { ...f, inputs: { ...f.inputs, text: TEXT_FIXES[text]! } }
    }
    if (f.feature !== 'ImageFeature') return f
    const src = f.inputs.src
    const banner = typeof src === 'string' && Object.hasOwn(LEGACY_HEADERS, src) ? LEGACY_HEADERS[src] : undefined
    if (banner === undefined) return f
    if (f.inputs.source !== 'illustration') {
      changed = true
      return { ...f, inputs: { ...f.inputs, source: 'illustration', illustration: banner, banner_height: 'short', responsive: true, alt: '' } }
    }
    // Upgraded to a banner before heights existed (version 2): make it short, keeping the illustration chosen.
    if (f.inputs.banner_height === undefined && typeof f.inputs.illustration === 'string' && f.inputs.illustration.startsWith('banner/')) {
      changed = true
      return { ...f, inputs: { ...f.inputs, banner_height: 'short' } }
    }
    return f
  })
  // Yahoo weather resources nothing points at any more (their texts became Weather cards above) go.
  const referenced = new Set(
    upgraded.flatMap((f) => {
      const def = typeof f?.inputs === 'object' && f.inputs !== null ? defaultRegistry.get(f.feature) : undefined
      return def ? referencedIds(def, f.inputs).map((r) => r.id) : []
    }),
  )
  const features = upgraded.filter((f) => !(typeof f?.inputs === 'object' && f.inputs !== null && isYahooWeather(f) && !referenced.has(f.id)))
  if (features.length !== upgraded.length) changed = true
  // In dependency order, without changing the page (the same object when nothing moves).
  return normalizeOrder(withProfileText(changed ? { ...model, features } : model))
}

/** The samples a browser is seeded with: written for this app (`sampleModels/`), copied so storage never shares them. */
export function sampleModels(): AppModel[] {
  return SAMPLE_MODELS.map((model) => structuredClone(model) as AppModel)
}
