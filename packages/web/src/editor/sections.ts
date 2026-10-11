import type { InputDef } from '@feature-domain/engine'

export interface InspectorSection {
  group: string | undefined
  inputs: InputDef[]
}

/**
 * The inspector's sections: the ungrouped inputs (name, disable, ...) first, then each `group` in the order the feature
 * declares it, whichever of its inputs are shown; a section with nothing shown is left out.
 */
export function inspectorSections(all: readonly InputDef[], shown: readonly InputDef[]): InspectorSection[] {
  const order = [undefined, ...new Set(all.map((i) => i.group).filter((g) => g !== undefined))]
  return order.map((group) => ({ group, inputs: shown.filter((i) => i.group === group) })).filter((section) => section.inputs.length > 0)
}
