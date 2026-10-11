// ---------------------------------------------------------------------------------------------------------------------
// Application model (v2)
// ---------------------------------------------------------------------------------------------------------------------

/** Parent id of features placed at the top level of the document. */
export const ROOT_ID = '$root'
/** The single slot the document root provides. */
export const ROOT_SLOT = 'content'

/**
 * Where a feature is placed: a slot of a parent feature, referenced by the parent's stable instance id. Renaming a
 * feature never breaks placement.
 */
export interface Placement {
  parent: string
  slot: string
}

export type InputValue = string | number | boolean | string[]

/** One feature instance. Its inputs are the parameters that drive generation. */
export interface FeatureInstance {
  feature: string
  id: string
  inputs: Record<string, InputValue>
  placement?: Placement
  /** Opaque data carried over from legacy models (e.g. a pre-fetched Swagger document). Ignored by the engine. */
  cache?: Record<string, unknown>
}

/** An application model: an ordered list of feature instances. */
export interface AppModel {
  version: 2
  id?: string
  name: string
  features: FeatureInstance[]
}

// ---------------------------------------------------------------------------------------------------------------------
// Document tree
// ---------------------------------------------------------------------------------------------------------------------

import type { ThemeTokens } from './theme/tokens.js'

export type Align = 'left' | 'center' | 'right'

/** Our own button styles: a solid accent, an outline, an accent tint, or a plain link. */
export const BUTTON_VARIANTS = ['primary', 'secondary', 'soft', 'link'] as const
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number]
export const BUTTON_SIZES = ['small', 'medium', 'large'] as const
export type ButtonSize = (typeof BUTTON_SIZES)[number]

/** Bootstrap's tones, as legacy models stored them. Only the migration reads them now. */
export const TONES = ['muted', 'primary', 'success', 'info', 'warning', 'danger'] as const
export type Tone = (typeof TONES)[number]

/** A header's text color from the theme: its ink (the default), the accent, or muted. */
export const HEADING_COLORS = ['ink', 'accent', 'muted'] as const
export type HeadingColor = (typeof HEADING_COLORS)[number]
/** What a header sits on: nothing, the accent's tint, or the theme's band color. */
export const HEADING_BACKGROUNDS = ['none', 'tint', 'band'] as const
export type HeadingBackground = (typeof HEADING_BACKGROUNDS)[number]
/** How much a panel stands out: normal, highlighted in the accent, or quiet (a small heading, no card fill). */
export const PANEL_EMPHASES = ['normal', 'highlight', 'quiet'] as const
export type PanelEmphasis = (typeof PANEL_EMPHASES)[number]

/**
 * Where a feature's rows come from at runtime: an address to fetch (`endPoint`, then the list at `path`), or a data
 * resource's sample rows (`rows`), served in the browser with any rows added since.
 */
export interface DataSource {
  /** The data resource's instance id. */
  feature: string
  /** The data resource's name. */
  resource: string
  operation: string
  endPoint: string
  path?: string
  rows?: Record<string, unknown>[]
}

/**
 * Something a feature does to a data resource (a Form's submit, a Table row's delete): the operation, its method and
 * address (`{name}` placeholders filled from the values), or the resource's sample rows when `sample` is set.
 */
export interface DataAction {
  feature: string
  resource: string
  operation: string
  method: string
  endPoint: string
  sample?: true
  /** Send the body form-encoded or as multipart form data (the spec says so), else as JSON. */
  requestType?: 'form' | 'multipart'
  /**
   * For adding to sample data, which has no server to number rows: the id field its rows carry, the highest id among
   * them, and whether ids are text ("6") or numbers. A row added without one gets the next.
   */
  sampleIds?: { field: string; after: number; text: boolean }
}

/** A Form input: a text or number field; `in` says where its value goes (path placeholder, query, or the body). */
export interface FormField {
  name: string
  label: string
  type: 'text' | 'number'
  required: boolean
  hint?: string
  in: 'path' | 'query' | 'body'
}

/** What a Chart draws: slices of one whole, bars across, columns up, or a line. */
export const CHART_TYPES = ['pie', 'donut', 'bar', 'column', 'line'] as const
export type ChartType = (typeof CHART_TYPES)[number]
/** Chart heights in px. */
export const CHART_HEIGHTS = { short: 220, medium: 300, tall: 400 } as const
export type ChartHeight = keyof typeof CHART_HEIGHTS

export interface TableColumn {
  field: string
  label: string
  /** Display filter applied by the renderer, e.g. "uppercase", "date", "number" or "badge". */
  filter?: string
}

/**
 * Props for each node kind. Renderers map a kind to a component typed by these props. Other packages can add kinds
 * with declaration merging: `declare module '@feature-domain/engine' { interface NodeKinds { chart: ChartProps } }`.
 */
export interface NodeKinds {
  root: Record<string, never>
  /** `theme`: the tokens of the Theme the page references; absent means the default theme. */
  page: { theme?: ThemeTokens }
  text: { text: string }
  /** `color` and `background` are absent for the defaults (ink, none). */
  heading: { text: string; level: number; align: Align; color?: Exclude<HeadingColor, 'ink'>; background?: Exclude<HeadingBackground, 'none'> }
  image: { src: string; alt: string; width: string; height: string; responsive: boolean; align: Align }
  /**
   * A built-in illustration (see `ILLUSTRATIONS`), drawn in the theme's colors. `alt` is empty for a decorative one;
   * `width` is a CSS size, or empty for the full width. The height follows from `aspect` (width / height; banners
   * only), else the illustration's own shape.
   */
  illustration: { name: string; alt: string; width: string; align: Align; aspect?: number }
  grid: { rows: number; columns: number; well: boolean }
  'grid-cell': { row: number; column: number }
  /** `emphasis` is absent for normal. */
  panel: { heading: string; emphasis?: Exclude<PanelEmphasis, 'normal'> }
  'panel-body': Record<string, never>
  /** `marker`: numbered (the default) or check marks. */
  list: { items: string[]; align: Align; marker?: 'number' | 'check' }
  /** A horizontal rule. `color` is empty for the theme's border color; `thickness` in px, `width` in % of the line. */
  separator: { style: SeparatorStyle; color: string; thickness: number; width: number; align: Align }
  /**
   * A text link; `href` is shown only if it is http(s) (the renderer enforces that). `ariaLabel` names it for screen
   * readers when the visible text alone doesn't say where it goes (e.g. two maps' "Open in Google Maps").
   */
  link: { text: string; href: string; ariaLabel?: string }
  /** A paragraph of plain text. `muted` is secondary text; `highlight` an emphasized closing line (e.g. a price). */
  paragraph: { text: string; emphasis?: 'muted' | 'highlight' }
  /** Layout: children stacked vertically with even spacing. */
  stack: Record<string, never>
  /** Layout: an image (first child) beside a body (second child); stacks on phone-width pages. */
  media: { side: 'left' | 'right' }
  /** Layout: children in a raised card on the theme's surface. */
  card: Record<string, never>
  /** A link styled as a button. */
  button: { text: string; href: string; variant: ButtonVariant; size: ButtonSize; align: Align }
  /**
   * Editor-only stand-in for a placed feature that produced no node: an unported (unknown) feature type, or a feature
   * skipped because of a problem. Only generated with `generate(model, registry, { placeholders: true })`.
   */
  placeholder: { feature: string; name: string; status: 'unknown' | 'skipped'; reason: string }
  /**
   * A chart of one value per row, labeled by another field (either guessed from the loaded rows when absent). Drawn
   * in the theme's chart colors; `description` is what screen readers hear (the data also sits in a hidden table).
   */
  /**
   * The weather at a place, fetched from `url` (Open-Meteo's forecast; absent without a valid location): the temperature
   * and conditions now, and the next `days` days. `place` names it for screen readers.
   */
  weather: { url?: string; place: string; units: 'fahrenheit' | 'celsius'; days: number }
  /** A form that sends its fields to a data resource (`action`); absent action: nothing to send to. */
  form: { title?: string; fields: FormField[]; submit: string; success: string; action?: DataAction }
  chart: { type: ChartType; height: number; title?: string; description?: string; labelField?: string; valueField?: string; valueFormat?: string; source?: DataSource }
  table: {
    /** Shown in the table's header with the row count. */
    title?: string
    /** Rows shown before the table scrolls (its header stays in view); absent shows every row. */
    scrollRows?: number
    /** Where rows come from at runtime. Absent when the operation could not be found. */
    source?: DataSource
    columns: TableColumn[]
    /** With no columns known until rows load: labels and filters for the columns the rows give, in order. */
    byPosition?: { labels: string[]; filters: string[] }
    /** Per-row delete action; `endPoint` may contain `{field}` placeholders filled from the row. */
    deleteAction?: DataAction
  }
}

/** `line` is a plain rule; the others draw the divider illustration of that name. */
export const SEPARATOR_STYLES = ['line', 'wave', 'dots', 'ruler'] as const
export type SeparatorStyle = (typeof SEPARATOR_STYLES)[number]

export type NodeKind = keyof NodeKinds

export interface DocNodeOf<K extends NodeKind> {
  id: string
  kind: K
  props: NodeKinds[K]
  /** Set on nodes that are slots: other features can be placed here under this key. */
  slot?: string
  featureInstanceId?: string
  style?: Record<string, string>
  children: DocNode[]
}

export type DocNode = { [K in NodeKind]: DocNodeOf<K> }[NodeKind]

// ---------------------------------------------------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------------------------------------------------

export type DiagnosticCode =
  | 'unknown-feature'
  | 'duplicate-id'
  | 'missing-placement'
  | 'unresolved-placement'
  | 'placement-ignored'
  | 'unresolved-reference'
  | 'undeclared-dependency'
  | 'missing-slot'
  | 'missing-node'
  | 'invalid-node-id'
  | 'duplicate-node-id'
  | 'cycle'
  | 'parent-skipped'
  | 'dependency-skipped'
  | 'suppressed'
  | 'out-of-order'
  | 'feature'
  | 'feature-error'

export type Severity = 'error' | 'warning' | 'info'

export interface Diagnostic {
  code: DiagnosticCode
  severity: Severity
  message: string
  featureInstanceId?: string
}
