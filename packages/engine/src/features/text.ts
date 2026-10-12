import type { FeatureDefinition } from '../feature.js'
import { asString, disableInput, nameInput } from '../inputs.js'
import { node as makeNode } from '../nodes.js'
import { VALUE_FILTERS, type NodeKinds, type TextPart } from '../types.js'
import { DATA_RESOURCE_TYPES, isDataResourceExports } from './data-resource.js'
import { listSource } from './sources.js'

/** `{{ path }}` or `{{ path | filter :argument }}`. */
const BINDING = /\{\{([^{}|]*)(?:\|([^{}]*))?\}\}/g

/**
 * A text split into literal runs and `{{path}}` values (with an optional table filter: `{{0.updated_at | date}}`).
 * Paths are read from data, never evaluated; a binding with an empty path stays literal text.
 */
export function parseBindings(text: string): TextPart[] {
  const parts: TextPart[] = []
  let last = 0
  const literal = (to: number) => {
    if (to <= last) return
    const previous = parts.at(-1)
    if (previous && 'text' in previous) previous.text += text.slice(last, to)
    else parts.push({ text: text.slice(last, to) })
  }
  for (const match of text.matchAll(BINDING)) {
    const path = match[1]!.trim()
    if (path === '') continue
    literal(match.index)
    const filter = match[2]?.trim()
    parts.push(filter ? { path, filter, binding: match[0] } : { path, binding: match[0] })
    last = match.index + match[0].length
  }
  literal(text.length)
  return parts
}

export const TextFeature: FeatureDefinition = {
  type: 'TextFeature',
  name: 'Text',
  icon: 'pencil',
  placement: 'required',
  inputs: [
    nameInput(),
    disableInput,
    {
      name: 'text',
      label: 'Text',
      type: 'string',
      default: 'Say what this part of the page is about in a sentence or two.',
      hint: 'Values from data, with a Data Resource below: {{public_repos}}, {{0.name}}, {{length}}, {{0.updated_at | date}}',
      control: 'text-input',
    },
    // Soft: a text whose resource goes away still shows, with its values as written.
    { name: 'data_resource', label: 'Data Resource', type: 'reference', accepts: DATA_RESOURCE_TYPES, soft: true, default: '', control: 'resource-select', group: 'Values from data' },
    { name: 'operation', label: 'Operation', type: 'string', default: '', control: 'operation-select', methods: ['GET'], group: 'Values from data' },
  ],

  generate(inputs, ctx) {
    const node = (props: NodeKinds['text']) =>
      // Text whose values are filled in from data isn't a plain copy of the input, so only text without them is edited in place.
      makeNode('text', ctx.nodeId(), props, props.data ? {} : { edit: { text: { input: 'text', kind: 'text' } } })
    const text = asString(inputs.text)
    const props: NodeKinds['text'] = { text }
    const parts = parseBindings(text)
    const bound = parts.some((p) => 'path' in p)
    const resourceId = asString(inputs.data_resource)
    if (resourceId === '') {
      if (bound) ctx.report('warning', 'The text has {{…}} values but no Data Resource to read them from, so they show as written')
      return { node: node(props) }
    }
    const resolved = ctx.resolve(resourceId)
    // A missing or unusable resource is reported by the engine (a soft reference); the values show as written.
    if (!resolved || !isDataResourceExports(resolved.exports)) return { node: node(props) }
    if (!bound) {
      ctx.report('info', 'The text has a Data Resource but no {{…}} values to fill in')
      return { node: node(props) }
    }
    for (const part of parts) {
      if (!('filter' in part) || part.filter === undefined) continue
      const name = /^([A-Za-z]\w*)/.exec(part.filter)?.[1]
      if (!name || !(VALUE_FILTERS as readonly string[]).includes(name)) ctx.report('warning', `${part.binding} names an unknown filter "${part.filter}"; the value shows unfiltered`)
    }
    const { source } = listSource(resolved.id, resolved.exports, asString(inputs.operation), ctx, 'a text', 'values')
    if (source) {
      // Values read the whole answer (as the legacy app's did), not the list a table picks out of it.
      const { path: _list, ...whole } = source
      props.data = { source: whole, parts }
    }
    return { node: node(props) }
  },
}
