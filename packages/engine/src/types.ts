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

export const TONES = ['muted', 'primary', 'success', 'info', 'warning', 'danger'] as const
export type Tone = (typeof TONES)[number]

export interface TableColumn {
  field: string
  label: string
  /** Display filter applied by the renderer, e.g. "uppercase" or "date". */
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
  heading: { text: string; level: number; align: Align; tone?: Tone; background?: Tone }
  image: { src: string; alt: string; width: string; height: string; responsive: boolean; align: Align }
  grid: { rows: number; columns: number; well: boolean }
  'grid-cell': { row: number; column: number }
  panel: { heading: string; tone?: Tone }
  'panel-body': Record<string, never>
  /** `marker`: numbered (the default) or check marks. */
  list: { items: string[]; align: Align; marker?: 'number' | 'check' }
  /** A horizontal rule. `color` is empty for the theme's border colour; `thickness` in px, `width` in % of the line. */
  separator: { color: string; thickness: number; width: number; align: Align }
  /** A text link; `href` is shown only if it is http(s) (the renderer enforces that). */
  link: { text: string; href: string }
  /** A paragraph of plain text. `muted` is secondary text; `highlight` an emphasised closing line (e.g. a price). */
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
  table: {
    /** Where rows come from at runtime. Absent when the operation could not be found. */
    source?: { feature: string; resource: string; operation: string; endPoint: string; path?: string }
    columns: TableColumn[]
    /** Per-row delete action; `endPoint` may contain `{field}` placeholders filled from the row. */
    deleteAction?: { operation: string; endPoint: string }
  }
}

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
