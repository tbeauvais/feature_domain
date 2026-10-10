import { cellSlot, MAX_COLUMNS, MAX_ROWS } from '../features/container.js'
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
  for (const { id, feature, inputs } of instances) {
    const name = str(inputs.name)
    if (DATA_RESOURCE_TYPES.includes(feature) && !resources.has(name)) resources.set(name, id)
    if (feature === 'DataResourceFeature') operations.set(id, { name, operations: [operationName(httpMethod(str(inputs.operation)), str(inputs.resource))] })
  }

  const features = instances.map(({ id, feature, inputs, raw }): FeatureInstance => {
    const note = noteFor(id)
    const ctx: Context = { note, resourceId: (name) => resources.get(name), resourceOperations: (rid) => operations.get(rid) }
    const migrateInputs = INPUTS[feature]
    const out: FeatureInstance = { feature, id, inputs: migrateInputs ? migrateInputs(inputs, ctx) : scalarInputs(inputs) }

    if (!migrateInputs) {
      note('unported-feature', 'info', `${feature} is not ported yet; scalar inputs copied and the legacy instance kept in cache.legacy`)
      out.cache = { legacy: raw }
    } else if (isNonEmptyObject(raw.cache)) {
      out.cache = raw.cache
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

// Page colours came from the legacy Bootstrap look; pages are now styled by their theme.
const LEGACY_PAGE_COLOURS = ['border_color', 'background_color'] as const

function notePageColours(inputs: Raw, note: Context['note']): void {
  const dropped = LEGACY_PAGE_COLOURS.filter((name) => str(inputs[name]).trim() !== '')
  if (dropped.length > 0) {
    note('dropped-style', 'info', `Dropped legacy page ${dropped.map((name) => `${name} "${str(inputs[name])}"`).join(' and ')}; pages are styled by their theme`)
  }
}

/**
 * Header looks: Bootstrap's tones become our own options. Primary and info were the accent; success, warning and danger
 * become the accent too (status colours are kept for status, not decoration), and any tinted background becomes a tint.
 */
function headerLooks(textStyle: unknown, background: unknown, note: Context['note']): { colour: string; background: string } {
  const text = normalizeTone(textStyle)
  const fill = normalizeTone(background)
  const status = (tone: Tone | undefined) => tone === 'success' || tone === 'warning' || tone === 'danger'
  if (status(text)) note('mapped-style', 'info', `Header text style "${text}" is now the accent colour; status colours are kept for status`)
  if (status(fill)) note('mapped-style', 'info', `Header background "${fill}" is now the accent tint; status colours are kept for status`)
  return { colour: text === undefined ? 'ink' : text === 'muted' ? 'muted' : 'accent', background: fill === undefined ? 'none' : 'tint' }
}

function without(inputs: Raw, names: readonly string[]): Record<string, InputValue> {
  return Object.fromEntries(Object.entries(inputs).filter(([name]) => !names.includes(name))) as Record<string, InputValue>
}

/**
 * Upgrades for v2 features saved before an input changed shape. Each returns the new inputs, or undefined when the
 * instance is already current, so a model with nothing to upgrade stays the same object.
 */
const INPUT_UPGRADES: Record<string, (inputs: Raw, note: Context['note']) => Record<string, InputValue> | undefined> = {
  // Saved before page colours were dropped: they still carry them, though nothing renders them.
  PageFeature: (i, note) => {
    if (!LEGACY_PAGE_COLOURS.some((name) => name in i)) return undefined
    notePageColours(i, note)
    return without(i, LEGACY_PAGE_COLOURS)
  },
  // Saved with Bootstrap tones (text_style, and background as a tone).
  HeaderFeature: (i, note) => {
    if (!('text_style' in i) && normalizeTone(i.background) === undefined) return undefined
    return { ...without(i, ['text_style', 'background']), ...headerLooks(i.text_style, i.background, note) }
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

/** The legacy instance kept for a feature that was unported when migrated, if its type can be migrated now. */
function pendingLegacy(f: FeatureInstance): Raw | undefined {
  const legacy = f.cache?.legacy
  return INPUTS[f.feature] && typeof legacy === 'object' && legacy !== null && !Array.isArray(legacy) ? (legacy as Raw) : undefined
}

function upgrade(model: AppModel): MigrationResult {
  if (!model.features.some((f) => pendingLegacy(f) || upgradeInputs(f, () => {}))) return { model, notes: [] }
  const notes: MigrationNote[] = []
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
    if (f.feature === 'DataResourceFeature') operations.set(f.id, { name, operations: [operationName(httpMethod(str(inputs.operation)), str(inputs.resource))] })
  }

  const features = model.features.map((f): FeatureInstance => {
    const legacy = pendingLegacy(f)
    const note = (code: MigrationNoteCode, severity: MigrationNote['severity'], message: string) => notes.push({ code, severity, message, featureInstanceId: f.id })
    if (!legacy) {
      const inputs = upgradeInputs(f, note)
      return inputs ? { ...f, inputs } : f
    }
    const ctx: Context = { note, resourceId: (name) => resources.get(name), resourceOperations: (rid) => operations.get(rid) }
    const out: FeatureInstance = { feature: f.feature, id: f.id, inputs: INPUTS[f.feature]!(legacyInputs(f), ctx) }
    // Placement was resolved when the model was first migrated (unported features were placed too).
    if (f.placement && !DATA_RESOURCE_TYPES.includes(f.feature)) out.placement = f.placement
    if (isNonEmptyObject(legacy.cache)) out.cache = legacy.cache
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
    notePageColours(i, ctx.note)
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

  DataResourceFeature: (i) => ({ name: str(i.name), resource: str(i.resource), operation: httpMethod(str(i.operation)) }),

  TableFeature: (i, ctx) => {
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
