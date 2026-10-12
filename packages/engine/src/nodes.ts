import type { EditMarks } from './text-edit.js'
import type { DocNode, DocNodeOf, NodeKind, NodeKinds } from './types.js'

export interface NodeOptions {
  children?: DocNode[]
  style?: Record<string, string>
  /** Marks this node as a slot with the given key. */
  slot?: string
  /** Which inputs the node's text props copy (see `EditMark`). */
  edit?: EditMarks
}

export function node<K extends NodeKind>(kind: K, id: string, props: NodeKinds[K], options: NodeOptions = {}): DocNodeOf<K> {
  const out: DocNodeOf<K> = { id, kind, props, children: options.children ?? [] }
  if (options.slot !== undefined) out.slot = options.slot
  if (options.edit && Object.keys(options.edit).length > 0) out.edit = options.edit
  if (options.style && Object.keys(options.style).length > 0) out.style = options.style
  return out
}

export function walkNodes(root: DocNode, visit: (n: DocNode) => void): void {
  visit(root)
  for (const child of root.children) walkNodes(child, visit)
}

export function indexNodes(root: DocNode): Map<string, DocNode> {
  const index = new Map<string, DocNode>()
  walkNodes(root, (n) => index.set(n.id, n))
  return index
}
