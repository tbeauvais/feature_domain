import { cellSlot, MAX_COLUMNS } from '../features/container.js'
import { DATA_RESOURCE_TYPES, HTTP_METHODS } from '../features/data-resource.js'
import { ROOT_ID, ROOT_SLOT, type AppModel, type FeatureInstance, type InputValue, type Placement } from '../types.js'
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
  | 'markup-in-text'
  | 'data-binding'

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
}

export function isV2Model(value: unknown): value is AppModel {
  const v = value as Partial<AppModel> | null
  return typeof v === 'object' && v !== null && v.version === 2 && Array.isArray(v.features)
}

/**
 * Converts a legacy model (an `{ id, name, features }` object or a bare feature list) to the v2 format. Pure. v2
 * models are returned unchanged. Values are translated to what the legacy app actually rendered, and every
 * interpretation is recorded in `notes`.
 */
export function migrate(input: unknown): MigrationResult {
  if (isV2Model(input)) return { model: input, notes: [] }
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
      const { rows, columns } = legacyGrid(inputs)
      const dom = legacyDomId(inputs.name, id)
      for (let r = 1; r <= rows; r++) for (let c = 1; c <= columns; c++) provide(`container_${dom}_row_${r}_col_${c}`, id, cellSlot(r, c))
    }
  }

  // Legacy references were by data resource name; the first resource with a name won.
  const resources = new Map<string, string>()
  for (const { id, feature, inputs } of instances) {
    const name = str(inputs.name)
    if (DATA_RESOURCE_TYPES.includes(feature) && !resources.has(name)) resources.set(name, id)
  }

  const features = instances.map(({ id, feature, inputs, raw }): FeatureInstance => {
    const note = noteFor(id)
    const ctx: Context = { note, resourceId: (name) => resources.get(name) }
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

// ---------------------------------------------------------------------------------------------------------------------
// Per-feature input migrations. Each returns complete v2 inputs reproducing what the legacy app rendered.
// ---------------------------------------------------------------------------------------------------------------------

const INPUTS: Record<string, (inputs: Raw, ctx: Context) => Record<string, InputValue>> = {
  PageFeature: (i) => ({
    name: str(i.name),
    border_color: str(i.border_color),
    background_color: str(i.background_color),
    background_image: str(i.background_image),
  }),

  TextFeature: (i, ctx) => ({ name: str(i.name), disable: disable(i.disable, ctx), text: text(i.text, ctx) }),

  HeaderFeature: (i, ctx) => ({
    name: str(i.name),
    disable: disable(i.disable, ctx),
    text: text(i.text, ctx),
    size: int(i.size, 'size', 1, ctx),
    align: normalizeAlign(i.align, 'left'),
    text_style: normalizeTone(i.text_style) ?? '',
    background: normalizeTone(i.background) ?? '',
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

  ContainerFeature: (i, ctx) => {
    const { rows, columns } = legacyGrid(i)
    if (rows === 0 || columns === 0) {
      ctx.note('invalid-value', 'warning', `Container had no valid rows/columns (${JSON.stringify(i.rows)} x ${JSON.stringify(i.columns)}), so the legacy app rendered it empty; using the defaults`)
    }
    return {
      name: str(i.name),
      disable: disable(i.disable, ctx),
      rows: rows || 1,
      columns: Math.min(columns || 2, MAX_COLUMNS),
      well: truthy(i.well, 'well', ctx),
    }
  },

  PanelFeature: (i, ctx) => ({
    name: str(i.name),
    disable: disable(i.disable, ctx),
    style: normalizeTone(i.style) ?? '',
    heading: text(i.heading, ctx),
  }),

  DataResourceFeature: (i) => {
    const method = str(i.operation).toUpperCase()
    return {
      name: str(i.name),
      resource: str(i.resource),
      operation: (HTTP_METHODS as readonly string[]).includes(method) ? method : 'GET',
    }
  },

  TableFeature: (i, ctx) => {
    const ref = typeof i.data_resource === 'object' && i.data_resource !== null ? (i.data_resource as Raw) : {}
    const resourceName = str(ref.name) || str(i.resource)
    const resourceId = ctx.resourceId(resourceName)
    if (resourceId === undefined) {
      ctx.note('unresolved-reference', 'warning', resourceName ? `No data resource named "${resourceName}"` : 'No data resource selected')
    }
    return {
      name: str(i.name),
      disable: disable(i.disable, ctx),
      data_resource: resourceId ?? '',
      operation: str(ref.operation),
      delete_operation: str(ref.delete_operation),
      fields: list(i.fields),
      labels: list(i.labels),
      filters: list(i.filters),
    }
  },
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
