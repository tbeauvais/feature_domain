import type { FeatureDefinition } from '../feature.js'
import { asList, asString, disableInput, nameInput } from '../inputs.js'
import { isLinkAddress } from '../links.js'
import { node } from '../nodes.js'
import type { FormField, NodeKinds } from '../types.js'
import { DATA_RESOURCE_TYPES, isDataResourceExports, type DataOperation, type DataResourceExports } from './data-resource.js'
import { actionFor, defaultOperation, fieldLabel } from './sources.js'

/** At most this many fields are shown; a form longer than that wants splitting anyway. */
export const MAX_FORM_FIELDS = 30

const NUMBER_TYPES = ['integer', 'number', 'float', 'double', 'long']

/** The fields a form shows: its own list, else what the operation's spec says it takes, else the sample rows' keys. */
function fieldsFor(names: string[], labels: string[], operation: DataOperation | undefined, resource: DataResourceExports, required: string[]): FormField[] {
  return fieldsFrom(names, labels, operation, resource).map((f) => (required.includes(f.name) ? { ...f, required: true } : f))
}

function fieldsFrom(names: string[], labels: string[], operation: DataOperation | undefined, resource: DataResourceExports): FormField[] {
  if (names.length > 0) return names.map((name, i) => ({ name, label: labels[i] || fieldLabel(name), type: 'text', required: false, in: 'body' }))
  const parameters = (operation?.parameters ?? []).filter((p) => p.in !== 'header')
  if (parameters.length > 0) {
    return parameters.map((p, i) => {
      const field: FormField = {
        name: p.name,
        label: labels[i] || fieldLabel(p.name),
        type: NUMBER_TYPES.includes(p.type) ? 'number' : 'text',
        required: p.required,
        in: p.in === 'path' || p.in === 'query' ? p.in : 'body',
      }
      if (p.description) field.hint = p.description
      return field
    })
  }
  const rows = operation?.sample ? (resource.sampleRows ?? []) : []
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))].filter((k) => k.trim() !== '')
  return keys.map((name, i) => ({
    name,
    label: labels[i] || fieldLabel(name),
    type: rows.some((r) => typeof r[name] === 'number') ? 'number' : 'text',
    required: false,
    in: 'body',
  }))
}

/**
 * A form that sends what is typed to a data resource (legacy Form, which posted to a Swagger operation): with a spec,
 * its fields are the operation's inputs; on sample data, a submission adds a row every table and chart on the
 * resource shows at once.
 */
export const FormFeature: FeatureDefinition = {
  type: 'FormFeature',
  name: 'Form',
  icon: 'form',
  placement: 'required',
  inputs: [
    nameInput(),
    disableInput,
    { name: 'title', label: 'Title', type: 'string', default: '', control: 'text-input' },
    { name: 'data_resource', label: 'Data Resource', type: 'reference', accepts: DATA_RESOURCE_TYPES, required: true, default: '', control: 'resource-select' },
    { name: 'operation', label: 'Operation', type: 'string', default: '', control: 'operation-select', methods: ['POST', 'PUT'] },
    { name: 'fields', label: 'Fields', type: 'list', default: [], placeholder: 'From the operation', control: 'list-input' },
    { name: 'labels', label: 'Labels', type: 'list', default: [], control: 'list-input' },
    // Beyond what the spec requires (a spec often marks nothing): these must be filled in before sending.
    { name: 'required_fields', label: 'Required fields', type: 'list', default: [], placeholder: 'As the spec says', control: 'list-input' },
    { name: 'submit_label', label: 'Button text', type: 'string', default: 'Submit', control: 'text-input' },
    { name: 'success_message', label: 'Message after sending', type: 'string', default: 'Thanks, that was sent.', control: 'text-input' },
    {
      name: 'open_after',
      label: 'Then open',
      type: 'string',
      default: '',
      placeholder: 'Stay on the page',
      control: 'text-input',
      hint: 'An address to open after sending, with {name} filled from what was created, e.g. /models/{id}',
    },
  ],

  generate(inputs, ctx) {
    const props: NodeKinds['form'] = {
      fields: [],
      submit: asString(inputs.submit_label).trim() || 'Submit',
      success: asString(inputs.success_message).trim() || 'Thanks, that was sent.',
    }
    const title = asString(inputs.title).trim()
    if (title) props.title = title
    const open = asString(inputs.open_after).trim()
    if (open !== '' && !isLinkAddress(open))
      ctx.report('warning', `Then open "${open}" is not an http(s) address or a path on this site, so the form stays on the page`)
    else if (open !== '') props.open = open
    const resolved = ctx.resolve(asString(inputs.data_resource))
    if (!resolved || !isDataResourceExports(resolved.exports)) {
      ctx.report('error', 'Data resource did not export any operations')
      return { node: node('form', ctx.nodeId(), props) }
    }
    const resource = resolved.exports
    const name = resource.resource || resolved.id
    const operationName = asString(inputs.operation)
    // No operation chosen: the first that takes data (POST, else PUT), as the inspector's "First (…)" option says.
    const operation = operationName ? resource.operations.find((o) => o.name === operationName) : defaultOperation(resource.operations, ['POST', 'PUT'])
    if (operationName && !operation) ctx.report('warning', `Operation "${operationName}" is not provided by ${name}`)
    else if (!operation) ctx.report('warning', `${name} has no POST or PUT operation to send to`)
    else if (operation.method !== 'POST' && operation.method !== 'PUT')
      ctx.report('warning', `"${operation.name}" doesn't take data; a form sends with POST or PUT`)
    else if (!operation.sample && !/^https?:\/\//i.test(operation.endPoint))
      ctx.report('warning', `Operation "${operation.name}" of ${name} has no http(s) URL`)
    else props.action = actionFor(resolved.id, resource, operation)

    // Header parameters (e.g. an API key) can't be typed into a form, so a required one means the server will refuse.
    const headers = (operation?.parameters ?? []).filter((p) => p.in === 'header' && p.required).map((p) => `"${p.name}"`)
    if (headers.length > 0)
      ctx.report('warning', `"${operation!.name}" requires the header${headers.length === 1 ? '' : 's'} ${headers.join(', ')}, which a form can't send`)

    const required = asList(inputs.required_fields)
    const fields = fieldsFor(asList(inputs.fields), asList(inputs.labels), operation, resource, required)
    const unknown = required.filter((r) => !fields.some((f) => f.name === r))
    if (unknown.length > 0)
      ctx.report(
        'warning',
        `Required field${unknown.length === 1 ? '' : 's'} ${unknown.map((u) => `"${u}"`).join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not in the form`,
      )
    if (fields.length > MAX_FORM_FIELDS) ctx.report('warning', `Only the first ${MAX_FORM_FIELDS} of ${fields.length} fields are shown`)
    props.fields = fields.slice(0, MAX_FORM_FIELDS)
    if (props.fields.length === 0 && props.action)
      ctx.report('warning', 'The form has no fields: list them in Fields, or use an operation whose spec describes its inputs')
    return { node: node('form', ctx.nodeId(), props) }
  },
}
