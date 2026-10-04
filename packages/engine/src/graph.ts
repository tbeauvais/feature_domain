/** Directed dependency graph between feature instances. An edge from -> to means "to" depends on "from". */
export interface Graph {
  /** Nodes in model order; ordering ties are broken by this order. */
  nodes: string[]
  children: Map<string, string[]>
  parents: Map<string, string[]>
}

export interface TopoResult {
  /** Nodes in dependency order (parents before dependents), earliest model position first among ready nodes. */
  order: string[]
  /** Nodes that sit on a cycle. */
  cyclic: string[]
  /** Nodes not on a cycle but downstream of one. */
  blocked: string[]
}

/** Builds a graph. Edges whose endpoints are not both in `nodes` are ignored. */
export function buildGraph(nodes: readonly string[], edges: readonly (readonly [string, string])[]): Graph {
  const children = new Map(nodes.map((n) => [n, [] as string[]]))
  const parents = new Map(nodes.map((n) => [n, [] as string[]]))
  for (const [from, to] of edges) {
    const out = children.get(from)
    const into = parents.get(to)
    if (!out || !into || out.includes(to)) continue
    out.push(to)
    into.push(from)
  }
  return { nodes: [...nodes], children, parents }
}

export function topoSort(graph: Graph): TopoResult {
  const indegree = new Map(graph.nodes.map((n) => [n, graph.parents.get(n)?.length ?? 0]))
  const done = new Set<string>()
  const order: string[] = []

  for (;;) {
    const next = graph.nodes.find((n) => !done.has(n) && indegree.get(n) === 0)
    if (next === undefined) break
    done.add(next)
    order.push(next)
    for (const child of graph.children.get(next) ?? []) {
      indegree.set(child, (indegree.get(child) ?? 0) - 1)
    }
  }

  const remaining = graph.nodes.filter((n) => !done.has(n))
  const cyclic = remaining.filter((n) => reaches(graph, n, n))
  const blocked = remaining.filter((n) => !cyclic.includes(n))
  return { order, cyclic, blocked }
}

/** All transitive dependents of `id`, in model order. These are what must regenerate when `id` changes. */
export function dependentsOf(graph: Graph, id: string): string[] {
  const seen = new Set<string>()
  const stack = [...(graph.children.get(id) ?? [])]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (seen.has(n)) continue
    seen.add(n)
    stack.push(...(graph.children.get(n) ?? []))
  }
  seen.delete(id)
  return graph.nodes.filter((n) => seen.has(n))
}

function reaches(graph: Graph, from: string, target: string): boolean {
  const seen = new Set<string>()
  const stack = [...(graph.children.get(from) ?? [])]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n === target) return true
    if (seen.has(n)) continue
    seen.add(n)
    stack.push(...(graph.children.get(n) ?? []))
  }
  return false
}
