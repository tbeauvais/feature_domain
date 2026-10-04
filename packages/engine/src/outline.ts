import type { Diagnostic, DocNode } from './types'

/**
 * Renders a document tree as indented text, one node per line, for snapshots and debugging. e.g.
 *   heading #top_header_1 [1] {"text":"Hi","level":1,"align":"center"}
 */
export function renderOutline(root: DocNode): string {
  const lines: string[] = []
  const walk = (n: DocNode, depth: number) => {
    const owner = n.featureInstanceId ? ` [${n.featureInstanceId}]` : ''
    const props = Object.keys(n.props).length > 0 ? ` ${JSON.stringify(n.props)}` : ''
    const style = n.style ? ` style=${JSON.stringify(n.style)}` : ''
    lines.push(`${'  '.repeat(depth)}${n.kind} #${n.id}${owner}${props}${style}`)
    for (const child of n.children) walk(child, depth + 1)
  }
  walk(root, 0)
  return lines.join('\n')
}

export function formatDiagnostic(d: Diagnostic): string {
  return `${d.severity} ${d.code}${d.featureInstanceId ? ` [${d.featureInstanceId}]` : ''}: ${d.message}`
}
