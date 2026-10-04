/** Where a feature instance is placed: a page and a target slot id (legacy values carry a leading '#'). */
export interface PageLocation {
  name: string
  target: string
}

/** One feature instance in an application model. Only its inputs drive generation. */
export interface FeatureInstance {
  feature: string
  id: string
  inputs: Record<string, unknown>
  cache?: Record<string, unknown>
}

/** A persisted application model: an ordered list of feature instances. */
export interface AppModel {
  id?: string
  name: string
  features: FeatureInstance[]
}

/** A node in the generated document tree. Renderers map `kind` to a component. */
export interface DocNode {
  id: string
  kind: string
  featureInstanceId?: string
  props: Record<string, unknown>
  style?: Record<string, string>
  children: DocNode[]
}

export type DiagnosticCode =
  | 'unknown-feature'
  | 'duplicate-id'
  | 'missing-target'
  | 'unresolved-target'
  | 'duplicate-target'
  | 'missing-slot'
  | 'duplicate-node-id'
  | 'cycle'
  | 'parent-skipped'
  | 'suppressed'

export type Severity = 'error' | 'warning' | 'info'

export interface Diagnostic {
  code: DiagnosticCode
  severity: Severity
  message: string
  featureInstanceId?: string
}
