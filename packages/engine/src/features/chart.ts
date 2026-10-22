import type { FeatureDefinition } from '../feature.js'
import { asOneOf, asString, disableInput, heightInput, nameInput } from '../inputs.js'
import { node } from '../nodes.js'
import { readHeight, type HeightScale } from '../sizes.js'
import { CHART_HEIGHTS, CHART_TYPES, type NodeKinds } from '../types.js'
import { DATA_RESOURCE_TYPES, isDataResourceExports } from './data-resource.js'
import { listSource } from './sources.js'

const TYPE_LABELS: Record<(typeof CHART_TYPES)[number], string> = { pie: 'Pie', donut: 'Donut', bar: 'Bars', column: 'Columns', line: 'Line' }
/** Chart heights in pixels: the names, or any height from 160 to 640 in steps of 10. */
export const CHART_HEIGHT_SCALE: HeightScale = { named: CHART_HEIGHTS, unit: 'px', min: 160, max: 640, step: 10 }

/**
 * A chart of a data resource's rows (legacy GoogleChart, whose Google Image Charts service is retired): one value per
 * row, labeled by another field. The renderer draws it with Chart.js in the theme's chart colors.
 */
export const ChartFeature: FeatureDefinition = {
  type: 'GoogleChartFeature',
  name: 'Chart',
  icon: 'chart',
  placement: 'required',
  inputs: [
    nameInput(),
    disableInput,
    { name: 'title', label: 'Title', type: 'string', default: '', control: 'text-input' },
    { name: 'data_resource', label: 'Data Resource', type: 'reference', accepts: DATA_RESOURCE_TYPES, required: true, default: '', control: 'resource-select' },
    { name: 'operation', label: 'Operation', type: 'string', default: '', control: 'operation-select', methods: ['GET'] },
    {
      name: 'chart_type',
      label: 'Type',
      type: 'string',
      default: 'column',
      control: 'segmented',
      options: CHART_TYPES.map((value) => ({ value, text: TYPE_LABELS[value] })),
    },
    { name: 'label_field', label: 'Label field', type: 'string', default: '', placeholder: 'first text field', control: 'text-input' },
    { name: 'value_field', label: 'Value field', type: 'string', default: '', placeholder: 'first number field', control: 'text-input' },
    // A display filter for the values (axis, tooltips, the screen-reader table), as tables use: "currency", "number :1".
    { name: 'value_format', label: 'Value format', type: 'string', default: '', placeholder: 'e.g. currency', control: 'text-input' },
    heightInput('height', CHART_HEIGHT_SCALE),
    { name: 'description', label: 'Description (for screen readers)', type: 'string', default: '', control: 'text-input' },
  ],

  generate(inputs, ctx) {
    const height = readHeight(inputs.height, CHART_HEIGHT_SCALE)
    if (!height) ctx.report('warning', `Height "${asString(inputs.height)}" should be short, medium, tall or pixels; using medium`)
    const props: NodeKinds['chart'] = {
      type: asOneOf(inputs.chart_type, CHART_TYPES, 'column'),
      height: height?.value ?? CHART_HEIGHTS.medium,
    }
    for (const [prop, input] of [
      ['title', 'title'],
      ['description', 'description'],
      ['labelField', 'label_field'],
      ['valueField', 'value_field'],
      ['valueFormat', 'value_format'],
    ] as const) {
      const value = asString(inputs[input]).trim()
      if (value) props[prop] = value
    }
    const resolved = ctx.resolve(asString(inputs.data_resource))
    if (!resolved || !isDataResourceExports(resolved.exports)) {
      ctx.report('error', 'Data resource did not export any operations')
      return { node: node('chart', ctx.nodeId(), props) }
    }
    const { source } = listSource(resolved.id, resolved.exports, asString(inputs.operation), ctx, 'a chart')
    if (source) props.source = source
    return { node: node('chart', ctx.nodeId(), props) }
  },
}
