// Building blocks for higher-level features: they compose their output from the same primitive nodes the simple
// features use (heading, paragraph, image, list) and a few layout nodes (stack, media, card), so styling and safety
// rules live in one place. (Composite features, a later phase, let users build such features from primitives.)

import type { FeatureContext } from '../feature.js'
import { node } from '../nodes.js'
import type { DocNode } from '../types.js'

/** Text split on blank lines into paragraph nodes with ids `<part>1`, `<part>2`, … */
export function paragraphs(ctx: FeatureContext, part: string, text: string): DocNode[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== '')
    .map((p, index) => node('paragraph', ctx.nodeId(`${part}${index + 1}`), { text: p }))
}

/** A section title (level 4 heading). Omitted when empty. */
export function title(ctx: FeatureContext, part: string, text: string): DocNode[] {
  return text.trim() === '' ? [] : [node('heading', ctx.nodeId(part), { text: text.trim(), level: 4, align: 'left' })]
}
