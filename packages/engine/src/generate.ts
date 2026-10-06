import { referencedIds, type FeatureDefinition, type FeatureOutput, type FeatureRegistry, type ResolvedFeature } from './feature.js'
import { defaultRegistry } from './features/index.js'
import { buildGraph, topoSort, type Graph } from './graph.js'
import { asBool, asString, resolveInputs, type Inputs } from './inputs.js'
import { node, walkNodes } from './nodes.js'
import { ROOT_ID, ROOT_SLOT, type AppModel, type Diagnostic, type DocNode, type FeatureInstance, type Placement } from './types.js'

/** `unknown`: the feature type is not in the registry (e.g. not ported yet). */
export type FeatureStatus = 'generated' | 'suppressed' | 'skipped' | 'unknown'

export interface FeatureMetadata {
  id: string
  feature: string
  name: string
  status: FeatureStatus
  /** Valid placement, if the feature is placed. */
  placement?: Placement
  /** Slot keys this feature provides. */
  slots: string[]
  /** Instance ids this feature references. */
  references: string[]
  /** Why the feature was not generated (skipped, suppressed or unknown): the first problem found, not later effects. */
  reason?: string
  /** Instance id of the Page this feature sits under, if any. */
  page?: string
}

/** A place a feature can be dropped into. */
export interface TargetMetadata {
  parent: string
  slot: string
  label: string
}

export interface AppMetadata {
  pages: { id: string; name: string }[]
  features: FeatureMetadata[]
  /** Slots that generated features actually produced (plus the document root). */
  targets: TargetMetadata[]
}

export type EdgeKind = 'placement' | 'reference'

export interface GenerateResult {
  root: DocNode
  metadata: AppMetadata
  /** Dependencies over every known feature: an edge a -> b means b is placed in a, or references a. */
  graph: Graph
  edgeKinds: ReadonlyMap<string, EdgeKind>
  /** Dependency order of the graph (dependencies first). Features on or behind a cycle are absent. */
  order: string[]
  diagnostics: Diagnostic[]
}

export const edgeKey = (from: string, to: string) => `${from}->${to}`
const slotKey = (parent: string, slot: string) => `${parent}/${slot}`

interface Entry {
  instance: FeatureInstance
  def: FeatureDefinition
  inputs: Inputs
  index: number
  slots: string[]
  /** Instance ids this feature may resolve. */
  declared: Set<string>
  placement?: Placement
}

/**
 * Regenerates the whole document from a model. Pure: the model and feature outputs are never mutated, and the same
 * model and registry always produce the same result. Never throws: every problem, including a feature that throws,
 * becomes a diagnostic.
 */
export interface GenerateOptions {
  /**
   * Editor mode: placed features that produced no node (unknown types, or skipped because of a problem) get a
   * `placeholder` node where they would be, so they stay visible and selectable. Suppressed features do not.
   */
  placeholders?: boolean
}

export function generate(model: AppModel, registry: FeatureRegistry = defaultRegistry, options: GenerateOptions = {}): GenerateResult {
  const diagnostics: Diagnostic[] = []
  const report = (d: Diagnostic) => diagnostics.push(d)
  const status = new Map<string, FeatureStatus>()
  const reasons = new Map<string, string>()
  const fail = (id: string, d: Omit<Diagnostic, 'featureInstanceId'>) => {
    status.set(id, 'skipped')
    if (!reasons.has(id)) reasons.set(id, d.message)
    report({ ...d, featureInstanceId: id })
  }
  /** Runs feature code outside generate(); an exception skips the feature instead of escaping. */
  const attempt = <T>(id: string, what: string, fn: () => T, fallback: T): T => {
    try {
      return fn()
    } catch (error) {
      fail(id, { code: 'feature-error', severity: 'error', message: `Feature threw in ${what}: ${errorMessage(error)}` })
      return fallback
    }
  }

  // 1. Collect known features.
  const entries = new Map<string, Entry>()
  const unknown = new Map<string, FeatureInstance>()
  const modelIds = new Set<string>()
  model.features.forEach((instance, index) => {
    const id = instance.id
    if (modelIds.has(id)) {
      report({ code: 'duplicate-id', severity: 'error', featureInstanceId: id, message: `Instance id "${id}" is used more than once; later instance ignored` })
      return
    }
    modelIds.add(id)
    const def = registry.get(instance.feature)
    if (!def) {
      unknown.set(id, instance)
      reasons.set(id, `${instance.feature} is not ported yet`)
      report({ code: 'unknown-feature', severity: 'warning', featureInstanceId: id, message: `Unknown feature type "${instance.feature}"` })
      return
    }
    const inputs = resolveInputs(def.inputs, instance.inputs)
    const slots = attempt(id, 'slots()', () => def.slots?.(inputs) ?? [], [])
    entries.set(id, { instance, def, inputs, index, slots, declared: new Set() })
  })
  const describe = (id: string) => {
    const e = entries.get(id)
    const name = e ? asString(e.inputs.name) : ''
    return name ? `feature ${id} ("${name}")` : `feature ${id}`
  }

  // 2. Resolve placements and references into dependency edges.
  const edges: [string, string][] = []
  const edgeKinds = new Map<string, EdgeKind>()
  const addEdge = (from: string, to: string, kind: EdgeKind) => {
    const key = edgeKey(from, to)
    if (edgeKinds.get(key) === 'placement') return
    if (!edgeKinds.has(key)) edges.push([from, to])
    edgeKinds.set(key, kind)
  }

  for (const [id, e] of entries) {
    const p = e.instance.placement
    if (e.def.placement === 'none') {
      if (p) report({ code: 'placement-ignored', severity: 'warning', featureInstanceId: id, message: `${e.def.name} features are not placed; placement ignored` })
    } else if (!p) {
      fail(id, { code: 'missing-placement', severity: 'error', message: 'Feature has no placement' })
    } else if (p.parent === ROOT_ID) {
      if (p.slot === ROOT_SLOT) e.placement = p
      else fail(id, { code: 'unresolved-placement', severity: 'error', message: `The document root has no slot "${p.slot}"` })
    } else {
      const parent = entries.get(p.parent)
      if (!parent) {
        const why = modelIds.has(p.parent) ? 'is not a known feature type' : 'does not exist'
        fail(id, { code: 'unresolved-placement', severity: 'error', message: `Parent feature ${p.parent} ${why}` })
      } else if (!parent.slots.includes(p.slot)) {
        fail(id, { code: 'unresolved-placement', severity: 'error', message: `Parent ${describe(p.parent)} has no slot "${p.slot}"` })
      } else {
        e.placement = p
        addEdge(p.parent, id, 'placement')
      }
    }

    for (const input of e.def.inputs) {
      if (input.type === 'reference' && input.required && asString(e.inputs[input.name]) === '') {
        fail(id, { code: 'unresolved-reference', severity: 'error', message: `No ${input.label} selected` })
      }
    }
    const refs = [
      ...referencedIds(e.def, e.inputs).map((r) => ({ ...r, accepts: e.def.inputs.find((i) => i.name === r.input)?.accepts })),
      ...attempt(id, 'dependencies()', () => e.def.dependencies?.(e.inputs) ?? [], []).map((refId) => ({ input: 'dependencies', id: refId, accepts: undefined })),
    ]
    for (const ref of refs) {
      const target = entries.get(ref.id)
      if (!target) {
        fail(id, { code: 'unresolved-reference', severity: 'error', message: `Input "${ref.input}" references feature ${ref.id}, which ${modelIds.has(ref.id) ? 'is not a known feature type' : 'does not exist'}` })
      } else if (ref.accepts && !ref.accepts.includes(target.instance.feature)) {
        fail(id, { code: 'unresolved-reference', severity: 'error', message: `Input "${ref.input}" must reference one of ${ref.accepts.join(', ')}, not ${target.instance.feature}` })
      } else {
        e.declared.add(ref.id)
        addEdge(ref.id, id, 'reference')
      }
    }
  }

  const graph = buildGraph([...entries.keys()], edges)
  const { order, cyclic, blocked } = topoSort(graph)
  for (const id of cyclic) fail(id, { code: 'cycle', severity: 'error', message: 'Feature depends on itself (dependency cycle)' })
  for (const id of blocked) fail(id, { code: 'dependency-skipped', severity: 'warning', message: 'Feature depends on a feature in a dependency cycle' })

  // Model order should list dependencies first, so a rollback to "after feature N" never shows orphans.
  for (const [from, to] of edges) {
    if (entries.get(from)!.index > entries.get(to)!.index) {
      const relation = edgeKinds.get(edgeKey(from, to)) === 'placement' ? 'is placed in' : 'references'
      report({ code: 'out-of-order', severity: 'warning', featureInstanceId: to, message: `Listed before ${describe(from)}, which it ${relation}` })
    }
  }

  // 3. Generate features in dependency order. Feature output is never mutated; the tree is assembled from copies.
  const resolved = new Map<string, ResolvedFeature>()
  const generated = new Map<string, DocNode>()
  const slotNodes = new Map<string, DocNode>()
  const nodeIds = new Set([ROOT_ID])

  for (const id of order) {
    if (status.has(id)) continue
    const e = entries.get(id)!
    const parents = graph.parents.get(id) ?? []
    const relation = (p: string) => (edgeKinds.get(edgeKey(p, id)) === 'placement' ? 'Parent' : 'Referenced')

    const suppressedBy = parents.find((p) => status.get(p) === 'suppressed')
    if (asBool(e.inputs.disable) || suppressedBy !== undefined) {
      status.set(id, 'suppressed')
      reasons.set(id, suppressedBy === undefined ? 'Feature is suppressed' : `${relation(suppressedBy)} ${describe(suppressedBy)} is suppressed`)
      const message = suppressedBy === undefined ? 'Feature is suppressed' : `${relation(suppressedBy)} ${describe(suppressedBy)} is suppressed`
      report({ code: 'suppressed', severity: 'info', featureInstanceId: id, message })
      continue
    }
    const failedBy = parents.find((p) => status.get(p) !== 'generated')
    if (failedBy !== undefined) {
      const code = relation(failedBy) === 'Parent' ? 'parent-skipped' : 'dependency-skipped'
      fail(id, { code, severity: 'warning', message: `${relation(failedBy)} ${describe(failedBy)} was not generated` })
      continue
    }
    if (e.placement && e.placement.parent !== ROOT_ID && !slotNodes.has(slotKey(e.placement.parent, e.placement.slot))) {
      fail(id, { code: 'parent-skipped', severity: 'warning', message: `Parent ${describe(e.placement.parent)} did not generate slot "${e.placement.slot}"` })
      continue
    }

    const undeclared = new Set<string>()
    let out: FeatureOutput
    try {
      out = e.def.generate(e.inputs, {
      instanceId: id,
      nodeId: (part) => (part === undefined ? id : `${id}.${part}`),
      resolve: (refId) => {
        if (e.declared.has(refId)) return resolved.get(refId)
        if (!undeclared.has(refId)) {
          undeclared.add(refId)
          report({ code: 'undeclared-dependency', severity: 'error', featureInstanceId: id, message: `Tried to read feature ${refId} without declaring it as a dependency` })
        }
        return undefined
      },
      report: (severity, message) => report({ code: 'feature', severity, featureInstanceId: id, message }),
      })
    } catch (error) {
      fail(id, { code: 'feature-error', severity: 'error', message: `Feature threw during generation: ${errorMessage(error)}` })
      continue
    }

    if (e.def.placement === 'required') {
      if (!out.node) {
        fail(id, { code: 'missing-node', severity: 'error', message: 'Feature did not generate a document node' })
        continue
      }
      const featureNode: DocNode = { ...out.node, featureInstanceId: id }
      const ownIds: string[] = []
      walkNodes(featureNode, (n) => ownIds.push(n.id))
      const foreign = ownIds.find((nodeId) => nodeId !== id && !nodeId.startsWith(`${id}.`))
      if (foreign !== undefined) {
        fail(id, { code: 'invalid-node-id', severity: 'error', message: `Generated node id "${foreign}" is not owned by this feature (use ctx.nodeId)` })
        continue
      }
      const clash = ownIds.find((nodeId, i) => nodeIds.has(nodeId) || ownIds.indexOf(nodeId) !== i)
      if (clash !== undefined) {
        fail(id, { code: 'duplicate-node-id', severity: 'error', message: `Generated node id "${clash}" is already in use` })
        continue
      }
      for (const nodeId of ownIds) nodeIds.add(nodeId)
      const ownSlots = new Map<string, DocNode>()
      walkNodes(featureNode, (n) => {
        if (n.slot !== undefined && !ownSlots.has(n.slot)) ownSlots.set(n.slot, n)
      })
      for (const slot of e.slots) {
        const slotNode = ownSlots.get(slot)
        if (slotNode) slotNodes.set(slotKey(id, slot), slotNode)
        else report({ code: 'missing-slot', severity: 'error', featureInstanceId: id, message: `Feature declares slot "${slot}" but did not generate it` })
      }
      generated.set(id, featureNode)
    }
    resolved.set(id, { id, feature: e.instance.feature, name: asString(e.inputs.name), exports: frozenCopy(out.exports ?? {}) })
    status.set(id, 'generated')
  }

  // 4. Assemble the tree. Features are appended to their slot in model order, so siblings keep the order users chose.
  const template = node('root', ROOT_ID, {}, { slot: ROOT_SLOT })
  slotNodes.set(slotKey(ROOT_ID, ROOT_SLOT), template)
  const keyOfSlotNode = new Map([...slotNodes].map(([key, n]) => [n, key]))
  const placed = new Map<string, DocNode[]>()
  const place = (p: Placement, n: DocNode) => {
    const key = slotKey(p.parent, p.slot)
    placed.set(key, [...(placed.get(key) ?? []), n])
  }
  for (const id of modelIds) {
    const e = entries.get(id)
    const featureNode = generated.get(id)
    if (featureNode && e?.placement) {
      place(e.placement, featureNode)
    } else if (options.placeholders) {
      const stand = placeholderFor(id)
      if (stand) place(stand.placement, stand.node)
    }
  }

  function placeholderFor(id: string): { placement: Placement; node: DocNode } | undefined {
    const e = entries.get(id)
    const instance = e?.instance ?? unknown.get(id)!
    const p = e ? e.placement : instance.placement
    const known = e !== undefined
    if (!p || (known && status.get(id) !== 'skipped') || !slotNodes.has(slotKey(p.parent, p.slot)) || nodeIds.has(id)) return undefined
    nodeIds.add(id)
    const props = {
      feature: instance.feature,
      name: asString(instance.inputs.name),
      status: known ? ('skipped' as const) : ('unknown' as const),
      reason: reasons.get(id) ?? 'Not generated',
    }
    return { placement: p, node: { ...node('placeholder', id, props), featureInstanceId: id } }
  }
  const assemble = (n: DocNode): DocNode => {
    const key = keyOfSlotNode.get(n)
    const attached = key === undefined ? [] : (placed.get(key) ?? [])
    return { ...n, children: [...n.children, ...attached].map(assemble) }
  }

  return {
    root: assemble(template),
    metadata: buildMetadata(modelIds, entries, unknown, status, reasons, new Set(slotNodes.keys())),
    graph,
    edgeKinds,
    order,
    diagnostics,
  }
}

function buildMetadata(
  modelIds: Set<string>,
  entries: Map<string, Entry>,
  unknown: Map<string, FeatureInstance>,
  status: Map<string, FeatureStatus>,
  reasons: Map<string, string>,
  generatedSlots: Set<string>,
): AppMetadata {
  const placementOf = (id: string) => (entries.has(id) ? entries.get(id)!.placement : unknown.get(id)?.placement)
  const pageOf = (id: string, depth = 0): string | undefined => {
    if (depth > modelIds.size) return undefined
    const feature = entries.get(id)?.instance.feature ?? unknown.get(id)?.feature
    if (feature === 'PageFeature') return id
    const p = placementOf(id)
    return p && p.parent !== ROOT_ID ? pageOf(p.parent, depth + 1) : undefined
  }

  const features: FeatureMetadata[] = []
  const pages: AppMetadata['pages'] = []
  const targets: TargetMetadata[] = [{ parent: ROOT_ID, slot: ROOT_SLOT, label: 'Document' }]
  for (const id of modelIds) {
    const e = entries.get(id)
    if (!e) {
      const instance = unknown.get(id)!
      const f: FeatureMetadata = { id, feature: instance.feature, name: asString(instance.inputs.name), status: 'unknown', reason: reasons.get(id)!, slots: [], references: [] }
      if (instance.placement) f.placement = instance.placement
      const page = pageOf(id)
      if (page !== undefined) f.page = page
      features.push(f)
      continue
    }
    const name = asString(e.inputs.name)
    const f: FeatureMetadata = {
      id,
      feature: e.instance.feature,
      name,
      status: status.get(id) ?? 'skipped',
      slots: e.slots,
      references: [...e.declared],
    }
    const reason = reasons.get(id)
    if (f.status !== 'generated' && reason !== undefined) f.reason = reason
    if (e.placement) f.placement = e.placement
    const page = pageOf(id)
    if (page !== undefined) f.page = page
    features.push(f)

    if (f.status !== 'generated') continue
    if (e.instance.feature === 'PageFeature') pages.push({ id, name })
    for (const slot of e.slots.filter((s) => generatedSlots.has(slotKey(id, s)))) targets.push({ parent: id, slot, label: `${name || id} › ${slot}` })
  }
  return { pages, features, targets }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A deep, frozen copy of plain data (objects and arrays), so no consumer can change what another one reads. */
export function frozenCopy<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map(frozenCopy)) as T
  if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = frozenCopy(v)
    return Object.freeze(out) as T
  }
  return value
}
