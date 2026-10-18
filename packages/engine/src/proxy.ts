// What the Worker's /api/v1/proxy may fetch for a model: only addresses the model itself sends through the server.

import { DATA_RESOURCE_TYPES, isDataResourceExports } from './features/data-resource.js'
import { defaultRegistry } from './features/index.js'
import type { FeatureRegistry } from './feature.js'
import { generate } from './generate.js'
import { asString } from './inputs.js'
import type { AppModel } from './types.js'

/**
 * The addresses of a model's data resources whose Fetch through is Server: their operations' addresses (with `{name}`
 * placeholders as written) and an API spec's Spec URL (Load spec fetches it). Resources that don't generate (disabled,
 * skipped) and sample-data operations give none. The proxy allows any address on the same origin as one of these.
 */
export function proxyAddresses(model: AppModel, registry: FeatureRegistry = defaultRegistry): string[] {
  const result = generate(model, registry)
  const addresses = new Set<string>()
  for (const instance of model.features) {
    if (!DATA_RESOURCE_TYPES.includes(instance.feature)) continue
    const exports = result.exports.get(instance.id)
    if (!isDataResourceExports(exports) || exports.fetchThrough !== 'server') continue
    for (const operation of exports.operations) if (!operation.sample && operation.endPoint) addresses.add(operation.endPoint)
    const specUrl = asString(instance.inputs.spec_url).trim()
    if (instance.feature === 'SwaggerDataResourceFeature' && specUrl) addresses.add(specUrl)
  }
  return [...addresses]
}
