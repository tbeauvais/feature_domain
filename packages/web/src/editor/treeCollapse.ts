import type { ComputedRef, InjectionKey } from 'vue'

/** Which tree rows are collapsed; provided by FeatureTree to every TreeRow. */
export interface TreeCollapse {
  isCollapsed(id: string): boolean
  toggle(id: string): void
}

export const TREE_COLLAPSE: InjectionKey<TreeCollapse> = Symbol('tree-collapse')

/** Accent colour per Theme instance id, for the swatch on Theme rows. */
export const THEME_ACCENTS: InjectionKey<ComputedRef<Map<string, string>>> = Symbol('theme-accents')
