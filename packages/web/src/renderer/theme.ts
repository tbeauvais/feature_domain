import { deriveTokens, type ThemeTokens } from '@feature-domain/engine'
import { computed, inject, provide, type ComputedRef, type InjectionKey } from 'vue'

/**
 * The theme in effect for a subtree of the generated document. The element that carries a theme (the root now, pages
 * once they reference a Theme feature) provides it; components read their style choice (`panel`, `table`, `well`)
 * from the nearest one and put it on their own element, so a nested theme always wins over an outer one.
 */
export const THEME: InjectionKey<ComputedRef<ThemeTokens>> = Symbol('theme')

/** Warm Editorial, until pages reference a Theme feature. */
export const DEFAULT_TOKENS = deriveTokens()

export function provideTheme(theme: ComputedRef<ThemeTokens>): void {
  provide(THEME, theme)
}

export function useTheme(): ComputedRef<ThemeTokens> {
  return inject(THEME, () => computed(() => DEFAULT_TOKENS), true)
}
