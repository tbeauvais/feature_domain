// Publishing a model as an app at <slug>.<app domain>: the slug rules, what changes for a published app's stored rows,
// and what in a model only works in the builder.

import { databaseTableKeys, databaseTables, type DatabaseTable } from './app-data.js'
import { defaultRegistry } from './features/index.js'
import type { FeatureRegistry } from './feature.js'
import { generate } from './generate.js'
import { isModelsApiAddress, isSitePath } from './links.js'
import { TYPE_WORDS, type TableField } from './tables.js'
import type { AppModel, DataAction, DataSource, DocNode } from './types.js'

/** A slug is one DNS label: this long, of lowercase letters, digits and single hyphens, not starting or ending with one. */
export const MIN_SLUG_LENGTH = 3
export const MAX_SLUG_LENGTH = 40

/**
 * Names no app may take: hosts a site usually keeps for itself or that read as ours (`www`, `api`, `admin`, …), and names mail and
 * network clients look up on their own (`autodiscover`, `mta-sts`, `wpad`), so an app can't pass itself off as the platform.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set(
  (
    'about access account accounts admin api app apps assets auth autoconfig autodiscover billing blog builder cdn ' +
    'cloudflare dashboard dev docs editor email feature-domain ftp help home login logout mail mcp mta-sts ns1 ns2 ' +
    'preview root security signin signup smtp staging static status support system test webmail wpad www'
  ).split(' '),
)

/** What is wrong with a slug, in words, or undefined when it can be an app's address. */
export function slugProblem(slug: string): string | undefined {
  if (slug.length < MIN_SLUG_LENGTH || slug.length > MAX_SLUG_LENGTH) return `An address name is ${MIN_SLUG_LENGTH} to ${MAX_SLUG_LENGTH} characters long`
  if (!/^[a-z0-9-]+$/.test(slug)) return 'An address name uses only lowercase letters, digits and hyphens'
  if (slug.startsWith('-') || slug.endsWith('-')) return "An address name can't start or end with a hyphen"
  if (slug.includes('--')) return "An address name can't have two hyphens in a row"
  if (RESERVED_SLUGS.has(slug)) return `"${slug}" is kept for the site itself`
  return undefined
}

/**
 * A slug made from a model's name, for its first publish: "Team requests" -> "team-requests". Accents are dropped,
 * anything else becomes a hyphen, and a long one is cut after a whole word. A name that gives too short or a reserved slug gets "app-" in
 * front ("app-x"); one with no letters or digits at all gives "my-app".
 */
export function suggestSlug(name: string): string {
  const words = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (words === '') return 'my-app'
  // Cut at the last whole word that fits (or mid-word when the first word alone is too long).
  const fit = (s: string) => {
    if (s.length <= MAX_SLUG_LENGTH) return s
    const cut = s.slice(0, MAX_SLUG_LENGTH + 1)
    const end = cut.lastIndexOf('-')
    return end >= MIN_SLUG_LENGTH ? cut.slice(0, end) : s.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, '')
  }
  const slug = fit(words)
  return slugProblem(slug) === undefined ? slug : fit(`app-${words}`)
}

/**
 * How a draft's Database tables differ from the published app's, as they matter to the app's stored rows. Publishing
 * never changes a stored row: a removed field stays in the rows, unseen, and rows keep values of a changed type, so
 * these are warnings to read before publishing, not errors. Only a removed table loses its rows.
 */
export type SchemaChange =
  | { kind: 'removed-table'; table: string }
  | { kind: 'removed-field'; table: string; field: string }
  | { kind: 'changed-type'; table: string; field: string; from: TableField['type']; to: TableField['type'] }
  | { kind: 'newly-required'; table: string; field: string }
  | { kind: 'removed-options'; table: string; field: string; options: string[] }

/**
 * The changes from the published version's tables (by key, as `databaseTables` gives them) to the draft model's, table
 * by table in the published order, field by field in its order. A new table or field changes nothing stored. A draft
 * table that is still in the model but doesn't generate (a problem to fix) isn't removed: like a save, a publish keeps
 * its rows (`databaseTableKeys`), so it has no changes to list.
 */
export function diffSchemas(published: ReadonlyMap<string, DatabaseTable>, draft: AppModel, registry: FeatureRegistry = defaultRegistry): SchemaChange[] {
  const tables = databaseTables(draft, registry)
  const kept = new Set(databaseTableKeys(draft))
  const changes: SchemaChange[] = []
  for (const [key, before] of published) {
    const after = tables.get(key)
    if (!after) {
      if (!kept.has(key)) changes.push({ kind: 'removed-table', table: key })
      continue
    }
    for (const field of before.schema.fields) {
      const now = after.schema.fields.find((f) => f.name === field.name)
      if (!now) {
        changes.push({ kind: 'removed-field', table: key, field: field.name })
        continue
      }
      if (now.type !== field.type) {
        changes.push({ kind: 'changed-type', table: key, field: field.name, from: field.type, to: now.type })
        continue
      }
      // A default fills it in new rows, and a change checks only the fields it sends, so only one with no default counts.
      if (now.required && !field.required && now.default === undefined) changes.push({ kind: 'newly-required', table: key, field: field.name })
      const removed = (field.options ?? []).filter((o) => !(now.options ?? []).includes(o))
      if (removed.length > 0) changes.push({ kind: 'removed-options', table: key, field: field.name, options: removed })
    }
  }
  return changes
}

/** Where a model reaches the builder: a link or form going to one of its pages, or data read from its models API. */
export interface BuilderAddress {
  /** The feature that holds it (its instance id). */
  feature: string
  kind: 'link' | 'then-open' | 'data-link' | 'data'
  address: string
}

/**
 * The builder's addresses a model uses, which a published app can't reach: on an app's own host every path shows the
 * app again, and the models API isn't served there. Paths that stay on the app's page ("/", "/?…", "/#…") are fine.
 * Read from what the model generates, so a disabled feature or a link the page doesn't show counts for nothing.
 */
export function builderAddresses(model: Parameters<typeof generate>[0], registry: FeatureRegistry = defaultRegistry): BuilderAddress[] {
  const found: BuilderAddress[] = []
  const add = (feature: string | undefined, kind: BuilderAddress['kind'], address: string) => {
    if (feature !== undefined && !found.some((f) => f.feature === feature && f.kind === kind && f.address === address)) found.push({ feature, kind, address })
  }
  const visit = (node: DocNode, feature: string | undefined) => {
    const owner = node.featureInstanceId ?? feature
    for (const [kind, address] of addressesOf(node)) {
      if (kind === 'data' ? isModelsApiAddress(address) : leavesApp(address)) add(owner, kind, address)
    }
    for (const child of node.children) visit(child, owner)
  }
  visit(generate(model, registry).root, undefined)
  return found
}

/** A site path that isn't the app's own page. */
function leavesApp(address: string): boolean {
  return isSitePath(address) && !/^\/(?:[?#]|$)/.test(address)
}

function addressesOf(node: DocNode): [BuilderAddress['kind'], string][] {
  const data = (...sources: (DataSource | DataAction | undefined)[]) =>
    sources.filter((s) => s !== undefined).map((s): [BuilderAddress['kind'], string] => ['data', s.endPoint])
  switch (node.kind) {
    case 'link':
    case 'button':
      return [['link', node.props.href.trim()]]
    case 'form':
      return [...data(node.props.action), ...(node.props.open ? [['then-open', node.props.open] as [BuilderAddress['kind'], string]] : [])]
    case 'table':
      return [
        ...data(node.props.source, node.props.deleteAction, node.props.updateAction),
        // Filters of its columns, or those applied by position once rows load.
        ...[...node.props.columns.map((c) => c.filter), ...(node.props.byPosition?.filters ?? [])].flatMap((filter): [BuilderAddress['kind'], string][] => {
          // Only a template is an address ("dataLink :/models/{id}"); "dataLink :html_url" reads one from the row.
          const link = /^\s*dataLink\s*:\s*(.*?)\s*$/.exec(filter ?? '')
          return link?.[1]?.includes('{') && leavesApp(link[1]) ? [['data-link', link[1]]] : []
        }),
      ]
    case 'chart':
      return data(node.props.source)
    case 'text':
      return data(node.props.data?.source)
    default:
      return []
  }
}

/**
 * A schema change in words, for the Publish dialog: what it does to the app's stored rows (`table` is the table's name).
 * A removed table is asked about on its own, with its row count.
 */
export function schemaChangeText(change: SchemaChange, table: string): string {
  switch (change.kind) {
    case 'removed-table':
      return `“${table}” is removed, and the app’s rows in it are deleted.`
    case 'removed-field':
      return `“${table}”: “${change.field}” is removed. The app’s rows keep their values for it, unseen.`
    case 'changed-type':
      return `“${table}”: “${change.field}” changes from ${TYPE_WORDS[change.from]} to ${TYPE_WORDS[change.to]}. The app’s rows keep the values they have.`
    case 'newly-required':
      return `“${table}”: “${change.field}” becomes required. The app’s rows without it keep it empty until they are changed.`
    case 'removed-options':
      return `“${table}”: “${change.field}” no longer offers ${change.options.map((o) => `“${o}”`).join(', ')}. The app’s rows that have them keep them.`
  }
}

/** A builder address in words, for the Publish dialog (`feature` is the feature's name). */
export function builderAddressText(found: BuilderAddress, feature: string): string {
  switch (found.kind) {
    case 'link':
      return `${feature} links to ${found.address}, which shows the app again on the app’s address.`
    case 'then-open':
      return `${feature} opens ${found.address} after sending, which shows the app again on the app’s address.`
    case 'data-link':
      return `${feature} links its rows to ${found.address}, which shows the app again on the app’s address.`
    case 'data':
      return `${feature} reads ${found.address}, the builder’s models, which the app can’t reach.`
  }
}
