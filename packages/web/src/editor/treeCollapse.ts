import { shallowRef, type ComputedRef, type InjectionKey } from 'vue'

/**
 * Ids of the collapsed tree rows: a view preference for the model being edited (FeatureTree resets it when another
 * model loads). Module state, like `dragState`, so drag and drop can re-register the rows a collapse or expand
 * re-creates.
 */
export const collapsedRows = shallowRef<ReadonlySet<string>>(new Set())

export function setCollapsed(ids: Iterable<string>): void {
  collapsedRows.value = new Set(ids)
}

export function toggleCollapsed(id: string): void {
  const next = new Set(collapsedRows.value)
  if (!next.delete(id)) next.add(id)
  collapsedRows.value = next
}

/** Accent colour per Theme instance id, for the swatch on Theme rows. */
export const THEME_ACCENTS: InjectionKey<ComputedRef<Map<string, string>>> = Symbol('theme-accents')
