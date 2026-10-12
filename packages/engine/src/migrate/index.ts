import { cellSlot, MAX_COLUMNS, MAX_ROWS } from '../features/container.js'
import { readApiSpec } from '../features/api-spec.js'
import { isSwagger12, swagger12ToOpenApi } from './swagger12.js'
import { DATA_RESOURCE_TYPES, HTTP_METHODS, httpMethod, operationName } from '../features/data-resource.js'
import { ROOT_ID, ROOT_SLOT, type AppModel, type FeatureInstance, type InputValue, type Placement, type Tone } from '../types.js'
import { legacyDomId, legacyGrid, normalizeAlign, normalizeTarget, normalizeTone } from './legacy.js'

export type MigrationNoteCode =
  | 'skipped-entry'
  | 'duplicate-id'
  | 'unported-feature'
  | 'coerced-value'
  | 'invalid-value'
  | 'duplicate-target'
  | 'unresolved-target'
  | 'unresolved-reference'
  | 'unresolved-operation'
  | 'markup-in-text'
  | 'data-binding'
  | 'upgraded-feature'
  | 'dropped-style'
  | 'mapped-style'
  | 'dropped-input'
  | 'mapped-input'
  | 'dead-service'
  | 'dropped-feature'

export interface MigrationNote {
  code: MigrationNoteCode
  severity: 'warning' | 'info'
  message: string
  featureInstanceId?: string
}

export interface MigrationResult {
  model: AppModel
  notes: MigrationNote[]
}

type Raw = Record<string, unknown>

interface Context {
  note(code: MigrationNoteCode, severity: MigrationNote['severity'], message: string): void
  /** Instance id of the first data resource with this legacy name. */
  resourceId(name: string): string | undefined
  /** Name and operation names of a migrated DataResource, when they are known without fetching anything. */
  resourceOperations(id: string): { name: string; operations: string[] } | undefined
  /** The legacy instance's cache (e.g. the Swagger spec the legacy app fetched and kept). */
  cache: Raw
}

/**
 * The cache kept for a migrated feature, without what its input migration moved into its inputs: a legacy Swagger 1.2
 * spec, which became the stored (converted) spec. Anything it couldn't convert stays, so nothing fetched is lost.
 */
function keptCache(feature: string, cache: unknown): Raw | undefined {
  if (!isNonEmptyObject(cache)) return undefined
  const consumed = (key: string) => feature === 'SwaggerDataResourceFeature' && key === 'swagger' && isSwagger12((cache as Raw).swagger)
  const kept = Object.fromEntries(Object.entries(cache as Raw).filter(([key]) => !consumed(key)))
  return Object.keys(kept).length > 0 ? kept : undefined
}

/** The operation names a data resource provides, as legacy references named them, for checking those references. */
function providedOperations(feature: string, inputs: Raw, cache: unknown): string[] | undefined {
  if (feature === 'DataResourceFeature') return [operationName(httpMethod(str(inputs.operation)), str(inputs.resource))]
  if (feature !== 'SwaggerDataResourceFeature') return undefined
  let spec: unknown = isNonEmptyObject(cache) ? (cache as Raw).swagger : undefined
  if (isSwagger12(spec)) spec = swagger12ToOpenApi(spec)
  if (spec === undefined && str(inputs.spec).trim() !== '') {
    try {
      spec = JSON.parse(str(inputs.spec))
    } catch {
      return undefined
    }
  }
  const read = spec === undefined ? undefined : readApiSpec(spec, str(inputs.spec_url) || str(inputs.resource))
  return read && !('problem' in read) ? read.operations.map((o) => o.name) : undefined
}

export function isV2Model(value: unknown): value is AppModel {
  const v = value as Partial<AppModel> | null
  return typeof v === 'object' && v !== null && v.version === 2 && Array.isArray(v.features)
}

/**
 * Converts a legacy model (an `{ id, name, features }` object or a bare feature list) to the v2 format. Pure. Values
 * are translated to what the legacy app actually rendered, and every interpretation is recorded in `notes`.
 *
 * v2 models are upgraded instead: features that were not ported when the model was migrated kept their legacy
 * instance in `cache.legacy`, and any whose type is ported now are migrated from it. A v2 model with nothing to
 * upgrade is returned unchanged (the same object).
 */
export function migrate(input: unknown): MigrationResult {
  if (isV2Model(input)) return upgrade(input)
  const legacy: Raw = Array.isArray(input) ? { features: input } : typeof input === 'object' && input !== null ? (input as Raw) : {}
  if (!Array.isArray(legacy.features)) throw new TypeError('Not an application model: expected a features array')

  const notes: MigrationNote[] = []
  const noteFor = (featureInstanceId: string | undefined) => (code: MigrationNoteCode, severity: MigrationNote['severity'], message: string) =>
    notes.push(featureInstanceId === undefined ? { code, severity, message } : { code, severity, message, featureInstanceId })

  // Well-formed legacy instances, first occurrence of each id.
  const instances: { id: string; feature: string; inputs: Raw; raw: Raw }[] = []
  const seen = new Set<string>()
  legacy.features.forEach((entry: unknown, index) => {
    const raw = entry as Raw
    if (typeof raw !== 'object' || raw === null || typeof raw.feature !== 'string' || (typeof raw.id !== 'string' && typeof raw.id !== 'number')) {
      noteFor(undefined)('skipped-entry', 'warning', `Entry ${index} is not a feature instance; skipped`)
      return
    }
    const id = String(raw.id)
    if (seen.has(id)) {
      noteFor(id)('duplicate-id', 'warning', `Instance id "${id}" is used more than once; later instance skipped`)
      return
    }
    seen.add(id)
    const inputs = typeof raw.inputs === 'object' && raw.inputs !== null ? (raw.inputs as Raw) : {}
    instances.push({ id, feature: raw.feature, inputs, raw })
  })

  // Legacy targets were DOM ids derived from the providing feature's name; map them to { parent, slot }.
  const providers = new Map<string, Placement & { by: string }>([['content_section', { parent: ROOT_ID, slot: ROOT_SLOT, by: 'the document' }]])
  const provide = (target: string, id: string, slot: string) => {
    const existing = providers.get(target)
    if (existing) noteFor(id)('duplicate-target', 'warning', `Legacy target "#${target}" is also provided by feature ${existing.by}; features placed there go to the first`)
    else providers.set(target, { parent: id, slot, by: id })
  }
  for (const { id, feature, inputs } of instances) {
    if (feature === 'PageFeature') provide('page_container', id, 'content')
    if (feature === 'PanelFeature') provide(`${legacyDomId(inputs.name, id)}_panel`, id, 'body')
    if (feature === 'ContainerFeature') {
      const { rows: legacyRows, columns } = legacyGrid(inputs)
      const rows = Math.min(legacyRows, MAX_ROWS)
      const dom = legacyDomId(inputs.name, id)
      for (let r = 1; r <= rows; r++) for (let c = 1; c <= columns; c++) provide(`container_${dom}_row_${r}_col_${c}`, id, cellSlot(r, c))
    }
  }

  // Legacy references were by data resource name; the first resource with a name won.
  const resources = new Map<string, string>()
  const operations = new Map<string, { name: string; operations: string[] }>()
  for (const { id, feature, inputs, raw } of instances) {
    const name = str(inputs.name)
    if (DATA_RESOURCE_TYPES.includes(feature) && !resources.has(name)) resources.set(name, id)
    const provided = providedOperations(feature, inputs, raw.cache)
    if (provided) operations.set(id, { name, operations: provided })
  }

  for (const { id, feature } of instances) if (isDropped(feature)) noteFor(id)('dropped-feature', 'warning', droppedNote(feature))
  const features = instances.filter(({ feature }) => !isDropped(feature)).map(({ id, feature, inputs, raw }): FeatureInstance => {
    const note = noteFor(id)
    const cache = isNonEmptyObject(raw.cache) ? (raw.cache as Raw) : {}
    const ctx: Context = { note, resourceId: (name) => resources.get(name), resourceOperations: (rid) => operations.get(rid), cache }
    const migrateInputs = Object.hasOwn(INPUTS, feature) ? INPUTS[feature] : undefined
    const out: FeatureInstance = { feature, id, inputs: migrateInputs ? migrateInputs(inputs, ctx) : scalarInputs(inputs) }

    if (!migrateInputs) {
      note('unported-feature', 'info', `${feature} is not ported yet; scalar inputs copied and the legacy instance kept in cache.legacy`)
      out.cache = { legacy: raw }
    } else {
      const kept = keptCache(feature, raw.cache)
      if (kept) out.cache = kept
    }

    if (!DATA_RESOURCE_TYPES.includes(feature)) {
      const location = inputs.page_location as Raw | undefined
      const target = typeof location?.target === 'string' ? normalizeTarget(location.target) : ''
      const provider = target ? providers.get(target) : undefined
      if (provider) out.placement = { parent: provider.parent, slot: provider.slot }
      else if (target) note('unresolved-target', 'warning', `Legacy target "#${target}" does not exist; feature left unplaced`)
      else note('unresolved-target', 'warning', 'No legacy page_location; feature left unplaced')
    }
    return out
  })

  const model: AppModel = { version: 2, name: str(legacy.name) || 'Untitled', features }
  if (typeof legacy.id === 'string') model.id = legacy.id
  return { model, notes }
}

// Page colors came from the legacy Bootstrap look; pages are now styled by their theme.
const LEGACY_PAGE_COLORS = ['border_color', 'background_color'] as const

function notePageColors(inputs: Raw, note: Context['note']): void {
  const dropped = LEGACY_PAGE_COLORS.filter((name) => str(inputs[name]).trim() !== '')
  if (dropped.length > 0) {
    note('dropped-style', 'info', `Dropped legacy page ${dropped.map((name) => `${name} "${str(inputs[name])}"`).join(' and ')}; pages are styled by their theme`)
  }
}

/**
 * Header looks: Bootstrap's tones become our own options. Primary and info were the accent; success, warning and danger
 * become the accent too (status colors are kept for status, not decoration), and any tinted background becomes a tint.
 */
function headerLooks(textStyle: unknown, background: unknown, note: Context['note']): { color: string; background: string } {
  const text = normalizeTone(textStyle)
  const fill = normalizeTone(background)
  const status = (tone: Tone | undefined) => tone === 'success' || tone === 'warning' || tone === 'danger'
  if (status(text)) note('mapped-style', 'info', `Header text style "${text}" is now the accent color; status colors are kept for status`)
  if (status(fill)) note('mapped-style', 'info', `Header background "${fill}" is now the accent tint; status colors are kept for status`)
  return { color: text === undefined ? 'ink' : text === 'muted' ? 'muted' : 'accent', background: fill === undefined ? 'none' : 'tint' }
}

/** Inputs with one renamed, in the same place; a value already under the new name wins. */
function renameInput(inputs: Raw, from: string, to: string): Raw {
  return Object.fromEntries(Object.entries(inputs).flatMap(([name, value]) => (name !== from ? [[name, value]] : to in inputs ? [] : [[to, value]])))
}

function without(inputs: Raw, names: readonly string[]): Record<string, InputValue> {
  return Object.fromEntries(Object.entries(inputs).filter(([name]) => !names.includes(name))) as Record<string, InputValue>
}

/**
 * Upgrades for v2 features saved before an input changed shape. Each returns the new inputs, or undefined when the
 * instance is already current, so a model with nothing to upgrade stays the same object.
 */
const INPUT_UPGRADES: Record<string, (inputs: Raw, note: Context['note']) => Record<string, InputValue> | undefined> = {
  // Saved before page colors were dropped: they still carry them, though nothing renders them.
  PageFeature: (i, note) => {
    if (!LEGACY_PAGE_COLORS.some((name) => name in i)) return undefined
    notePageColors(i, note)
    return without(i, LEGACY_PAGE_COLORS)
  },
  // Saved with Bootstrap tones (text_style, and background as a tone). A Color or Background already chosen (a model
  // also saved by a newer version) is kept; only what is still in the old shape is converted. Saved before US
  // spelling, the Color input was `colour`.
  HeaderFeature: (saved, note) => {
    const renamed = 'colour' in saved
    const i: Raw = renamed ? renameInput(saved, 'colour', 'color') : saved
    const toneBackground = normalizeTone(i.background) !== undefined
    if (!('text_style' in i) && !toneBackground) return renamed ? (i as Record<string, InputValue>) : undefined
    const looks = headerLooks('color' in i ? undefined : i.text_style, toneBackground ? i.background : undefined, note)
    const out: Record<string, InputValue> = without(i, ['text_style'])
    if (!('color' in i)) out.color = looks.color
    if (toneBackground || !('background' in i) || i.background === '') out.background = looks.background
    return out
  },
  // Saved with a Bootstrap panel style, which renders nothing now.
  PanelFeature: (i, note) => {
    if (!('style' in i)) return undefined
    if (str(i.style).trim() !== '') note('dropped-style', 'info', `Dropped legacy panel style "${str(i.style)}"; panels have an Emphasis instead`)
    return without(i, ['style'])
  },
}

function upgradeInputs(f: FeatureInstance, note: Context['note']): Record<string, InputValue> | undefined {
  return Object.hasOwn(INPUT_UPGRADES, f.feature) ? INPUT_UPGRADES[f.feature]!(f.inputs as Raw, note) : undefined
}

/**
 * Legacy feature types that are not ported and never will be, and why. Migration removes them (legacy models, and v2
 * models that stored them while unported), with a note.
 */
const DROPPED_FEATURES: Readonly<Record<string, string>> = {
  WatsonTextToSpeechFeature: "it spoke a fixed text through IBM's Watson Text to Speech service, which is gone; browsers and screen readers read pages aloud themselves",
  ScriptTestFeature: 'it ran a script built from its inputs, which pages never do',
}
const isDropped = (feature: string) => Object.hasOwn(DROPPED_FEATURES, feature)
const droppedNote = (feature: string) => `Removed ${feature}: ${DROPPED_FEATURES[feature]}`

/** The legacy instance kept for a feature that was unported when migrated, if its type can be migrated now. */
function pendingLegacy(f: FeatureInstance): Raw | undefined {
  const legacy = f.cache?.legacy
  return Object.hasOwn(INPUTS, f.feature) && typeof legacy === 'object' && legacy !== null && !Array.isArray(legacy) ? (legacy as Raw) : undefined
}

function upgrade(model: AppModel): MigrationResult {
  if (!model.features.some((f) => isDropped(f.feature) || pendingLegacy(f) || upgradeInputs(f, () => {}))) return { model, notes: [] }
  const notes: MigrationNote[] = []
  for (const f of model.features) if (isDropped(f.feature)) notes.push({ code: 'dropped-feature', severity: 'warning', message: droppedNote(f.feature), featureInstanceId: f.id })
  const legacyInputs = (f: FeatureInstance): Raw => {
    const raw = pendingLegacy(f)?.inputs
    return typeof raw === 'object' && raw !== null ? (raw as Raw) : (f.inputs as Raw)
  }

  // References by data resource name resolve exactly as in a full migration: the first resource with the name wins.
  const resources = new Map<string, string>()
  const operations = new Map<string, { name: string; operations: string[] }>()
  for (const f of model.features) {
    const inputs = legacyInputs(f)
    const name = str(inputs.name)
    if (DATA_RESOURCE_TYPES.includes(f.feature) && !resources.has(name)) resources.set(name, f.id)
    const provided = providedOperations(f.feature, inputs, pendingLegacy(f)?.cache)
    if (provided) operations.set(f.id, { name, operations: provided })
  }

  const features = model.features.filter((f) => !isDropped(f.feature)).map((f): FeatureInstance => {
    const legacy = pendingLegacy(f)
    const note = (code: MigrationNoteCode, severity: MigrationNote['severity'], message: string) => notes.push({ code, severity, message, featureInstanceId: f.id })
    if (!legacy) {
      const inputs = upgradeInputs(f, note)
      return inputs ? { ...f, inputs } : f
    }
    const cache = isNonEmptyObject(legacy.cache) ? (legacy.cache as Raw) : {}
    const ctx: Context = { note, resourceId: (name) => resources.get(name), resourceOperations: (rid) => operations.get(rid), cache }
    const out: FeatureInstance = { feature: f.feature, id: f.id, inputs: INPUTS[f.feature]!(legacyInputs(f), ctx) }
    // Placement was resolved when the model was first migrated (unported features were placed too).
    if (f.placement && !DATA_RESOURCE_TYPES.includes(f.feature)) out.placement = f.placement
    const kept = keptCache(f.feature, legacy.cache)
    if (kept) out.cache = kept
    note('upgraded-feature', 'info', `${f.feature} is ported now; migrated from the legacy settings kept in cache.legacy`)
    return out
  })
  return { model: { ...model, features }, notes }
}

// ---------------------------------------------------------------------------------------------------------------------
// Per-feature input migrations. Each returns complete v2 inputs reproducing what the legacy app rendered.
// ---------------------------------------------------------------------------------------------------------------------

const INPUTS: Record<string, (inputs: Raw, ctx: Context) => Record<string, InputValue>> = {
  PageFeature: (i, ctx) => {
    notePageColors(i, ctx.note)
    return { name: str(i.name), background_image: str(i.background_image) }
  },

  TextFeature: (i, ctx) => ({ name: str(i.name), disable: disable(i.disable, ctx), text: text(i.text, ctx) }),

  HeaderFeature: (i, ctx) => ({
    name: str(i.name),
    disable: disable(i.disable, ctx),
    text: text(i.text, ctx),
    size: int(i.size, 'size', 1, ctx),
    align: normalizeAlign(i.align, 'left'),
    ...headerLooks(i.text_style, i.background, ctx.note),
  }),

  ImageFeature: (i, ctx) => ({
    name: str(i.name),
    disable: disable(i.disable, ctx),
    src: str(i.src),
    alt: str(i.alt),
    height: str(i.height),
    width: str(i.width),
    responsive: truthy(i.responsive, 'responsive', ctx),
    align: normalizeAlign(i.align, 'left'),
  }),

  // Legacy looks are not carried over (see dropLegacyLooks): separators and buttons take the theme's defaults.
  SeparatorFeature: (i, ctx) => {
    dropLegacyLooks(i, ['color', 'height', 'width'], 'separator', ctx)
    return { name: str(i.name), disable: disable(i.disable, ctx), align: normalizeAlign(i.align, 'center') }
  },

  LinkFeature: (i, ctx) => ({ name: str(i.name), disable: disable(i.disable, ctx), text: text(i.text, ctx), href: str(i.href) }),

  ButtonFeature: (i, ctx) => {
    dropLegacyLooks(i, ['style', 'size'], 'button', ctx)
    return { name: str(i.name), disable: disable(i.disable, ctx), text: text(i.text, ctx), href: str(i.href), align: normalizeAlign(i.align, 'center') }
  },

  TextWithParagraphFeature: (i, ctx) => {
    dropLegacyLooks(i, ['style'], 'panel', ctx)
    return { name: str(i.name), disable: disable(i.disable, ctx), title: text(i.title, ctx).trim(), text: text(i.text, ctx) }
  },

  ImageWithParagraphFeature: (i, ctx) => {
    dropLegacyLooks(i, ['style'], 'panel', ctx)
    // The legacy app rendered the image with no alt text, on the left.
    return { name: str(i.name), disable: disable(i.disable, ctx), title: text(i.title, ctx).trim(), text: text(i.text, ctx), src: str(i.src), alt: '', image_side: 'left' }
  },

  // The legacy map was a keyless Google Static Maps image of the address; ours is a drawing with a Google Maps link.
  GoogleMapFeature: (i, ctx) => {
    dropLegacyLooks(i, ['height', 'width'], 'map', ctx)
    const out: Record<string, InputValue> = { name: str(i.name), disable: disable(i.disable, ctx), title: text(i.title, ctx).trim() }
    // A map with no usable address takes the input's default (the legacy palette's), as a missing one does.
    const address = text(i.address, ctx).trim()
    if (address !== '') out.address = address
    else if ('address' in i) ctx.note('invalid-value', 'warning', 'The map had no address; it shows the default address (131 Willow Rd. Guilford, CT) until one is set')
    return out
  },

  // The legacy list was one comma-separated string whose last item was shown large (the price in the samples).
  ListGroupFeature: (i, ctx) => {
    dropLegacyLooks(i, ['style', 'align'], 'list group', ctx)
    if (str(i.price).trim() !== '') ctx.note('dropped-input', 'info', `Dropped price "${str(i.price)}", which the legacy app never showed`)
    const items = str(i.list)
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== '')
    // The legacy app showed the last item large, even when it was the only one.
    const highlight = items.pop() ?? ''
    return { name: str(i.name), disable: disable(i.disable, ctx), heading: text(i.heading, ctx), description: text(i.description, ctx), items, highlight }
  },

  ContainerFeature: (i, ctx) => {
    const { rows, columns } = legacyGrid(i)
    if (rows === 0 || columns === 0) {
      ctx.note('invalid-value', 'warning', `Container had no valid rows/columns (${JSON.stringify(i.rows)} x ${JSON.stringify(i.columns)}), so the legacy app rendered it empty; using the defaults`)
    }
    if (rows > MAX_ROWS) {
      ctx.note('invalid-value', 'warning', `Container has ${rows} rows; capped at ${MAX_ROWS}, so features in later rows are left unplaced`)
    }
    return {
      name: str(i.name),
      disable: disable(i.disable, ctx),
      rows: Math.min(rows || 1, MAX_ROWS),
      columns: Math.min(columns || 2, MAX_COLUMNS),
      well: truthy(i.well, 'well', ctx),
    }
  },

  // Legacy rendered `list.split(',')` as <li> items in a 200px-wide box aligned by a Bootstrap class.
  ListFeature: (i, ctx) => ({
    name: str(i.name),
    disable: disable(i.disable, ctx),
    items: list(i.list),
    align: normalizeAlign(i.align, 'left'),
  }),

  // Legacy looks are not carried over: a panel's Bootstrap style is dropped, and it takes the normal emphasis.
  PanelFeature: (i, ctx) => {
    dropLegacyLooks(i, ['style'], 'panel', ctx)
    return { name: str(i.name), disable: disable(i.disable, ctx), heading: text(i.heading, ctx) }
  },

  DataResourceFeature: (i, ctx) => {
    // The legacy samples' weather came from Yahoo's query service, shut down in 2019.
    if (/^https?:\/\/query\.yahooapis\.com\//i.test(str(i.resource).trim())) {
      ctx.note('dead-service', 'warning', "Yahoo's weather service shut down in 2019, so this resource loads nothing; use a Weather feature to show the weather")
    }
    return { name: str(i.name), resource: str(i.resource), operation: httpMethod(str(i.operation)) }
  },

  // The legacy app fetched the spec when the page first ran and kept it in the instance's cache: converted from Swagger
  // 1.2 to OpenAPI 3 (the only version the feature reads), it becomes the stored spec. Its server is long gone.
  SwaggerDataResourceFeature: (i, ctx) => {
    const spec = ctx.cache.swagger
    if (!isSwagger12(spec)) {
      ctx.note(
        'invalid-value',
        'info',
        spec === undefined
          ? 'The legacy spec was never fetched; load an OpenAPI 3 spec from the Spec URL'
          : 'The legacy cached spec is not Swagger 1.2, so it was not converted (it stays in the cache); load an OpenAPI 3 spec from the Spec URL',
      )
      return { name: str(i.name), spec_url: str(i.resource), spec: '' }
    }
    ctx.note('coerced-value', 'info', 'Converted the legacy Swagger 1.2 spec to OpenAPI 3')
    // Compact: specs are stored with every model, in browser storage.
    return { name: str(i.name), spec_url: str(i.resource), spec: JSON.stringify(swagger12ToOpenApi(spec)) }
  },

  // Google Image Charts is retired: the chart is drawn by the app now, in the theme's colors (the legacy color, size
  // and alignment are dropped). The legacy app rendered "alt" nowhere visible; it becomes the screen-reader description.
  GoogleChartFeature: (i, ctx) => {
    const { resourceId, operation } = dataReference(i, ctx)
    dropLegacyLooks(i, ['color', 'height', 'width', 'align'], 'chart', ctx)
    const legacyType = str(i.type)
    const chartType = Object.hasOwn(LEGACY_CHART_TYPES, legacyType) ? LEGACY_CHART_TYPES[legacyType]! : 'column'
    if (legacyType === 'p3') ctx.note('coerced-value', 'info', 'The legacy 3D pie chart is drawn as a flat pie')
    else if (legacyType !== '' && !Object.hasOwn(LEGACY_CHART_TYPES, legacyType)) ctx.note('invalid-value', 'warning', `Unknown legacy chart type "${legacyType}"; drawn as columns`)
    if (str(i.filters).trim() !== '') ctx.note('dropped-input', 'info', `Dropped chart filters "${str(i.filters)}", which charts don't use`)
    return {
      name: str(i.name),
      disable: disable(i.disable, ctx),
      data_resource: resourceId ?? '',
      operation,
      chart_type: chartType,
      label_field: str(i.label),
      value_field: str(i.field),
      // "Cool chart" was the legacy default, not a description of anything.
      description: str(i.alt).trim() === 'Cool chart' ? '' : str(i.alt).trim(),
    }
  },

  // The legacy form built its fields from the Swagger operation's parameters and posted them form-encoded; ours does the
  // same from the spec. Its unused fields / labels inputs carry over (they override the spec when set).
  FormFeature: (i, ctx) => {
    const { resourceId, operation } = dataReference(i, ctx)
    if (str(i.filters).trim() !== '') ctx.note('dropped-input', 'info', `Dropped form filters "${str(i.filters)}", which forms don't use`)
    // The legacy form built its fields from the operation alone; here its own Fields list wins over the spec.
    if (list(i.fields).length > 0) ctx.note('mapped-input', 'info', `The form's fields are now "${list(i.fields).join(', ')}"; the legacy app took them from the operation instead`)
    return { name: str(i.name), disable: disable(i.disable, ctx), data_resource: resourceId ?? '', operation, fields: list(i.fields), labels: list(i.labels) }
  },

  TableFeature: (i, ctx) => {
    const { resourceId, operation, deleteOperation } = dataReference(i, ctx)
    return {
      name: str(i.name),
      disable: disable(i.disable, ctx),
      data_resource: resourceId ?? '',
      operation,
      delete_operation: deleteOperation,
      fields: list(i.fields),
      labels: list(i.labels),
      filters: list(i.filters),
    }
  },
}

/**
 * A legacy reference to a data resource (`data_resource: { name, operation, delete_operation }`, by name) as an instance
 * id and normalized operation names, noting a missing resource or an operation it doesn't provide.
 */
function dataReference(i: Raw, ctx: Context): { resourceId: string | undefined; operation: string; deleteOperation: string } {
  const ref = typeof i.data_resource === 'object' && i.data_resource !== null ? (i.data_resource as Raw) : {}
  const resourceName = str(ref.name) || str(i.resource)
  const resourceId = ctx.resourceId(resourceName)
  if (resourceId === undefined) {
    ctx.note('unresolved-reference', 'warning', resourceName ? `No data resource named "${resourceName}"` : 'No data resource selected')
  }
  const operation = normalizeOperation(str(ref.operation))
  const deleteOperation = normalizeOperation(str(ref.delete_operation))
  const provided = resourceId === undefined ? undefined : ctx.resourceOperations(resourceId)
  for (const name of [operation, deleteOperation]) {
    if (provided && name !== '' && !provided.operations.includes(name)) {
      ctx.note('unresolved-operation', 'warning', `Operation "${name}" is not provided by data resource "${provided.name}" (it provides ${provided.operations.map((o) => `"${o}"`).join(', ')})`)
    }
  }
  return { resourceId, operation, deleteOperation }
}

/** Legacy Google Image Charts types: pie (3D pie has no 3D here), vertical bars, horizontal bars. */
const LEGACY_CHART_TYPES: Readonly<Record<string, string>> = { p: 'pie', p3: 'pie', bvs: 'column', bhs: 'bar' }

/**
 * The migration carries over content and placement, not the legacy (Bootstrap-era) look: features take our own design
 * defaults and the theme. Records which styling inputs were set and dropped.
 */
function dropLegacyLooks(inputs: Raw, names: string[], what: string, ctx: Context): void {
  const set = names.filter((name) => str(inputs[name]).trim() !== '')
  if (set.length === 0) return
  const list = set.map((name) => `${name} "${str(inputs[name])}"`).join(', ')
  ctx.note('dropped-style', 'info', `Dropped legacy ${what} styling (${list}); it uses our own defaults and the theme`)
}

function str(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

/** Legacy suppression checked `disable == true` (CoffeeScript ===), so only boolean true suppressed. */
function disable(value: unknown, ctx: Context): boolean {
  if (typeof value === 'string' && value.trim().toLowerCase() === 'true') {
    ctx.note('coerced-value', 'info', 'disable is the string "true", which the legacy app ignored; feature stays visible')
  }
  return value === true
}

/** Other legacy booleans were plain JavaScript truthiness, so the string "false" meant on. */
function truthy(value: unknown, name: string, ctx: Context): boolean {
  if (typeof value === 'string' && ['false', '0', 'no', 'off'].includes(value.trim().toLowerCase())) {
    ctx.note('coerced-value', 'info', `${name} is the string "${value}", which the legacy app treated as on`)
  }
  return Boolean(value)
}

function int(value: unknown, name: string, fallback: number, ctx: Context): number {
  const n = parseInt(str(value), 10)
  if (Number.isFinite(n)) return n
  ctx.note('invalid-value', 'warning', `${name} is missing or not a number (${JSON.stringify(value ?? null)}); using ${fallback}`)
  return fallback
}

/** Legacy features injected text as raw HTML. v2 renders plain text, so flag anything that relied on HTML. */
function text(value: unknown, ctx: Context): string {
  const s = str(value)
  if (s.includes('{{')) ctx.note('data-binding', 'warning', 'Text contains a legacy {{...}} data binding; it renders as plain text until data bindings are supported')
  else if (/<[a-z!/]/i.test(s)) ctx.note('markup-in-text', 'warning', 'Text contains HTML markup, which the legacy app rendered as HTML; it now renders as plain text')
  return s
}

/** "get /path" -> "GET /path": operation names start with an uppercase HTTP method. */
function normalizeOperation(name: string): string {
  const match = /^(\S+)\s+(.*)$/.exec(name.trim())
  if (!match || !(HTTP_METHODS as readonly string[]).includes(match[1]!.toUpperCase())) return name
  return `${match[1]!.toUpperCase()} ${match[2]}`
}

function list(value: unknown): string[] {
  const s = str(value)
  return s === '' ? [] : s.split(',').map((part) => part.trim())
}

function scalarInputs(inputs: Raw): Record<string, InputValue> {
  const out: Record<string, InputValue> = {}
  for (const [k, v] of Object.entries(inputs)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v
  }
  return out
}

function isNonEmptyObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length > 0
}
