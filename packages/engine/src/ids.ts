import type { Inputs } from './inputs'
import type { DocNode } from './types'

/**
 * DOM-style id for a feature instance, e.g. name "My Container" + id "12" -> "my_container_12".
 * Matches the legacy app exactly (including "_5" for an empty name and "undefined_5" for a missing one) so existing
 * models' targets (e.g. "#container_my_container_12_row_1_col_1") resolve.
 */
export function instanceDomId(instanceId: string, inputs: Inputs): string {
  return `${String(inputs.name)}_${instanceId}`.replace(/\s+/g, '_').toLowerCase()
}

/** Strips the legacy leading '#' from a target selector. */
export function normalizeTarget(target: string): string {
  return target.trim().replace(/^#/, '')
}

export function node(
  id: string,
  kind: string,
  props: Record<string, unknown> = {},
  children: DocNode[] = [],
  style?: Record<string, string>,
): DocNode {
  return style && Object.keys(style).length > 0 ? { id, kind, props, style, children } : { id, kind, props, children }
}

export function indexNodes(root: DocNode, into = new Map<string, DocNode>()): Map<string, DocNode> {
  into.set(root.id, root)
  for (const child of root.children) indexNodes(child, into)
  return into
}
