import type { Diagnostic, DocNode } from './types.js'

/**
 * Renders a document tree as indented text, one node per line, for snapshots and debugging. e.g.
 *   grid-cell #12.r1c2 <r1c2> {"row":1,"column":2}
 *   heading #8 [8] {"text":"Hi","level":4,"align":"center"}
 * `<slot>` marks slots; `[id]` marks the feature instance that generated the node.
 */
export function renderOutline(root: DocNode): string {
  const lines: string[] = []
  const walk = (n: DocNode, depth: number) => {
    const slot = n.slot !== undefined ? ` <${n.slot}>` : ''
    const owner = n.featureInstanceId !== undefined ? ` [${n.featureInstanceId}]` : ''
    const props = Object.keys(n.props).length > 0 ? ` ${JSON.stringify(n.props)}` : ''
    const style = n.style ? ` style=${JSON.stringify(n.style)}` : ''
    lines.push(`${'  '.repeat(depth)}${n.kind} #${n.id}${slot}${owner}${props}${style}`)
    for (const child of n.children) walk(child, depth + 1)
  }
  walk(root, 0)
  return lines.join('\n')
}

export function formatDiagnostic(d: Diagnostic): string {
  return `${d.severity} ${d.code}${d.featureInstanceId !== undefined ? ` [${d.featureInstanceId}]` : ''}: ${d.message}`
}
