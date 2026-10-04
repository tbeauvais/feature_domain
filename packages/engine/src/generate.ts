import type { FeatureDefinition, FeatureRegistry } from './feature'
import { defaultRegistry } from './features'
import { buildGraph, topoSort, type Graph } from './graph'
import { indexNodes, instanceDomId, node, normalizeTarget } from './ids'
import { asBool, asString, DEFAULT_PAGE, pageLocation, type Inputs } from './inputs'
import type { AppModel, Diagnostic, DocNode, FeatureInstance } from './types'

/** The target the engine itself provides; Page features are placed here. */
export const ROOT_TARGET = 'content_section'
const ROOT_PROVIDER = '$root'

export type FeatureStatus = 'generated' | 'suppressed' | 'skipped'

export interface FeatureMetadata {
  id: string
  feature: string
  name: string
  domId: string
  page: string
  /** Target id (no '#') this feature is placed into. */
  target: string | undefined
  /** Target ids this feature provides. */
  slots: string[]
  status: FeatureStatus
}

export interface TargetMetadata {
  id: string
  page: string
  /** Providing feature instance id, or null for the engine's root target. */
  providedBy: string | null
}

export interface AppMetadata {
  pages: string[]
  features: FeatureMetadata[]
  /** Targets of generated features, i.e. places a new feature can be dropped into. */
  targets: TargetMetadata[]
}

export interface GenerateResult {
  root: DocNode
  metadata: AppMetadata
  /** Placement dependencies over every known feature: an edge parent -> child means the child is placed in a slot of the parent. */
  graph: Graph
  /** Dependency order of the graph (parents first). Features on or behind a cycle are absent. */
  order: string[]
  diagnostics: Diagnostic[]
}

interface Entry {
  instance: FeatureInstance
  def: FeatureDefinition
  inputs: Inputs
  domId: string
  page: string
  target: string | undefined
  slots: string[]
  disabled: boolean
}

/**
 * Regenerates the whole document from a model. Pure: the model is never mutated, and the same model and registry
 * always produce the same result.
 */
export function generate(model: AppModel, registry: FeatureRegistry = defaultRegistry): GenerateResult {
  const diagnostics: Diagnostic[] = []
  const report = (d: Diagnostic) => diagnostics.push(d)

  // 1. Collect every known feature instance.
  const entries = new Map<string, Entry>()
  for (const instance of model.features) {
    const id = instance.id
    if (entries.has(id)) {
      report({ code: 'duplicate-id', severity: 'error', featureInstanceId: id, message: `Instance id "${id}" is used more than once; later instance ignored` })
      continue
    }
    const def = registry.get(instance.feature)
    if (!def) {
      report({ code: 'unknown-feature', severity: 'warning', featureInstanceId: id, message: `Unknown feature type "${instance.feature}"` })
      continue
    }
    const inputs = instance.inputs
    const domId = instanceDomId(id, inputs)
    const loc = pageLocation(inputs)
    entries.set(id, {
      instance,
      def,
      inputs,
      domId,
      page: loc?.name ?? DEFAULT_PAGE,
      target: loc ? normalizeTarget(loc.target) : undefined,
      slots: def.slots?.(inputs, { instanceId: id, domId }) ?? [],
      disabled: asBool(inputs.disable),
    })
  }

  // 2. Map each target id to the feature that provides it. The first provider in model order wins; a feature that
  // loses any of its targets is skipped entirely, so children never land in it and node ids stay unique.
  const providers = new Map<string, string>([[ROOT_TARGET, ROOT_PROVIDER]])
  const status = new Map<string, FeatureStatus>()
  for (const [id, e] of entries) {
    for (const slot of e.slots) {
      const existing = providers.get(slot)
      if (existing === undefined) {
        providers.set(slot, id)
      } else if (existing !== id) {
        status.set(id, 'skipped')
        report({ code: 'duplicate-target', severity: 'error', featureInstanceId: id, message: `Target "#${slot}" is already provided by ${describe(existing)}; feature skipped` })
      }
    }
  }

  // 3. Build the placement dependency graph. Every feature is a node, including ones that cannot be placed, so
  // inspectors and dependentsOf see the whole model.
  const parentOf = new Map<string, string>()
  const edges: [string, string][] = []
  for (const [id, e] of entries) {
    if (e.target === undefined) {
      status.set(id, 'skipped')
      report({ code: 'missing-target', severity: 'error', featureInstanceId: id, message: 'Feature has no page_location target' })
      continue
    }
    const parent = providers.get(e.target)
    if (parent === undefined) {
      status.set(id, 'skipped')
      report({ code: 'unresolved-target', severity: 'error', featureInstanceId: id, message: `Target "#${e.target}" is not provided by any feature` })
      continue
    }
    parentOf.set(id, parent)
    if (parent !== ROOT_PROVIDER) edges.push([parent, id])
  }
  const graph = buildGraph([...entries.keys()], edges)
  const { order, cyclic, blocked } = topoSort(graph)
  for (const id of cyclic) {
    status.set(id, 'skipped')
    report({ code: 'cycle', severity: 'error', featureInstanceId: id, message: 'Feature is placed inside itself (placement cycle)' })
  }
  for (const id of blocked) {
    status.set(id, 'skipped')
    report({ code: 'parent-skipped', severity: 'warning', featureInstanceId: id, message: 'Parent feature is part of a placement cycle' })
  }

  // 4. Generate features in dependency order. Feature output is never mutated; the tree is assembled from copies.
  const slotOwners = new Map<string, DocNode>()
  const nodeIds = new Set([ROOT_TARGET])
  const generated = new Map<string, DocNode>()

  for (const id of order) {
    if (status.has(id)) continue
    const e = entries.get(id)!
    const parent = parentOf.get(id)!
    const parentStatus = parent === ROOT_PROVIDER ? 'generated' : status.get(parent)

    if (e.disabled || parentStatus === 'suppressed') {
      status.set(id, 'suppressed')
      report({ code: 'suppressed', severity: 'info', featureInstanceId: id, message: e.disabled ? 'Feature is suppressed' : 'Parent feature is suppressed' })
      continue
    }
    if (parentStatus !== 'generated') {
      status.set(id, 'skipped')
      report({ code: 'parent-skipped', severity: 'warning', featureInstanceId: id, message: `Parent ${describe(parent)} was not generated` })
      continue
    }
    if (parent !== ROOT_PROVIDER && !slotOwners.has(e.target!)) {
      status.set(id, 'skipped')
      report({ code: 'parent-skipped', severity: 'warning', featureInstanceId: id, message: `Parent ${describe(parent)} did not generate target "#${e.target}"` })
      continue
    }

    const out: DocNode = { ...e.def.generate(e.inputs, { instanceId: id, domId: e.domId }), featureInstanceId: id }
    const index = indexNodes(out)
    const clash = [...index.keys()].find((nodeId) => nodeIds.has(nodeId))
    if (clash !== undefined) {
      status.set(id, 'skipped')
      report({ code: 'duplicate-node-id', severity: 'error', featureInstanceId: id, message: `Generated node id "${clash}" is already in use; feature skipped` })
      continue
    }
    for (const nodeId of index.keys()) nodeIds.add(nodeId)
    for (const slot of e.slots) {
      const slotNode = index.get(slot)
      if (slotNode) slotOwners.set(slot, slotNode)
      else report({ code: 'missing-slot', severity: 'error', featureInstanceId: id, message: `Feature declares target "#${slot}" but did not generate it` })
    }
    generated.set(id, out)
    status.set(id, 'generated')
  }

  // 5. Assemble the tree. Generated features are appended to their parent slot in model order, so siblings keep
  // the order users arranged.
  const placed = new Map<string, DocNode[]>()
  for (const [id, e] of entries) {
    const out = generated.get(id)
    if (!out) continue
    const list = placed.get(e.target!) ?? []
    list.push(out)
    placed.set(e.target!, list)
  }
  const template = node(ROOT_TARGET, 'root')
  slotOwners.set(ROOT_TARGET, template)
  const assemble = (n: DocNode): DocNode => {
    const attached = slotOwners.get(n.id) === n ? (placed.get(n.id) ?? []) : []
    return { ...n, children: [...n.children, ...attached].map(assemble) }
  }

  return { root: assemble(template), metadata: buildMetadata(entries, status, providers), graph, order, diagnostics }

  function describe(providerId: string) {
    return providerId === ROOT_PROVIDER ? 'the page root' : `feature ${providerId}`
  }
}

function buildMetadata(entries: Map<string, Entry>, status: Map<string, FeatureStatus>, providers: Map<string, string>): AppMetadata {
  const features: FeatureMetadata[] = [...entries].map(([id, e]) => ({
    id,
    feature: e.instance.feature,
    name: asString(e.inputs.name),
    domId: e.domId,
    page: e.page,
    target: e.target,
    slots: e.slots,
    status: status.get(id) ?? 'skipped',
  }))
  const generatedFeatures = features.filter((f) => f.status === 'generated')
  const pages = [...new Set(generatedFeatures.map((f) => f.page))]
  const targets: TargetMetadata[] = []
  for (const [target, provider] of providers) {
    if (provider === ROOT_PROVIDER) {
      targets.push({ id: target, page: pages[0] ?? DEFAULT_PAGE, providedBy: null })
    } else if (status.get(provider) === 'generated') {
      targets.push({ id: target, page: entries.get(provider)!.page, providedBy: provider })
    }
  }
  return { pages, features, targets }
}
