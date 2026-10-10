import type { DocNode, ThemeTokens } from '@feature-domain/engine'
import { DEFAULT_TOKENS } from '../renderer/theme'

/**
 * The theme a feature renders with, as the renderer decides it: its page's theme, else (outside any page, or on a page
 * without one) the document's, which is the first page's theme or the default.
 */
export function themeForFeature(root: DocNode | undefined, featureId: string | null): ThemeTokens {
  const firstPage = root?.children.find((child) => child.kind === 'page')
  const documentTheme = (firstPage?.kind === 'page' ? firstPage.props.theme : undefined) ?? DEFAULT_TOKENS
  if (!root || featureId === null) return documentTheme
  const visit = (node: DocNode, inherited: ThemeTokens): ThemeTokens | undefined => {
    const theme = node.kind === 'page' ? (node.props.theme ?? inherited) : inherited
    if (node.featureInstanceId === featureId) return theme
    for (const child of node.children) {
      const found = visit(child, theme)
      if (found) return found
    }
    return undefined
  }
  return visit(root, documentTheme) ?? documentTheme
}
