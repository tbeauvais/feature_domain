// Inline text editing: generated text that is a plain copy of an input carries an edit mark saying which input (and
// which entry or paragraph of it), so the editor can edit the page and write the change back into the parameters. The
// page is a view of the inputs; editing the view edits the inputs.

import { EditError, updateInputs, type EditOptions } from './edit.js'
import { defaultRegistry } from './features/index.js'
import { asList, asString, resolveInputs, type InputDef } from './inputs.js'
import type { AppModel, DocNode, InputValue } from './types.js'

/**
 * Where a node's text came from. `text`: the whole input. `paragraph`: paragraph `index` (counting only non-empty ones)
 * of a text input split on blank lines. `item`: a list node's items, item i being entry `entries[i]` of a list input
 * (lists that leave out empty entries skip their indexes).
 */
export type EditMark =
  { input: string; kind: 'text' } | { input: string; kind: 'paragraph'; index: number } | { input: string; kind: 'item'; entries: number[] }

/** A node's edit marks, keyed by the prop holding the text (`text`, `heading`, `items`). */
export type EditMarks = Readonly<Record<string, EditMark>>

/** One editable piece of text in the model: a feature's input and, for lists and paragraphs, which entry. */
export type TextLocation = { feature: string; input: string; kind: 'text' } | { feature: string; input: string; kind: 'paragraph' | 'item'; at: number }

/** An editable text on the page: the node, the prop it shows, and for list nodes the item's position. */
export interface EditableText {
  node: DocNode
  prop: string
  item?: number
}

const PARAGRAPH_BREAK = /(\n\s*\n)/
const BREAK = '\n\n'

/** Input types each kind of mark can name. */
const KIND_INPUT_TYPES: Record<EditMark['kind'], readonly InputDef['type'][]> = {
  text: ['string', 'text'],
  paragraph: ['string', 'text'],
  item: ['list'],
}

/** Why a node's edit marks don't fit the feature's inputs and the node's props, or undefined when they do. */
export function editMarkProblem(n: DocNode, inputs: readonly InputDef[]): string | undefined {
  for (const [prop, mark] of Object.entries(n.edit ?? {})) {
    const value = (n.props as Record<string, unknown>)[prop]
    const def = inputs.find((i) => i.name === mark.input)
    if (!def) return `Node "${n.id}" marks its ${prop} as input "${mark.input}", which the feature doesn't declare`
    if (!KIND_INPUT_TYPES[mark.kind]?.includes(def.type))
      return `Node "${n.id}" marks its ${prop} as ${mark.kind} of input "${mark.input}", a ${def.type} input`
    const fits = mark.kind === 'item' ? Array.isArray(value) && value.length === mark.entries.length : typeof value === 'string'
    if (!fits) return `Node "${n.id}" marks its ${prop} as ${mark.kind} of input "${mark.input}", but its ${prop} doesn't match`
  }
  return undefined
}

/** The location a mark points at, for item `item` of a list node. */
export function markLocation(feature: string, mark: EditMark, item?: number): TextLocation | undefined {
  if (mark.kind === 'text') return { feature, input: mark.input, kind: 'text' }
  if (mark.kind === 'paragraph') return { feature, input: mark.input, kind: 'paragraph', at: mark.index }
  const at = item === undefined ? undefined : mark.entries[item]
  return at === undefined ? undefined : { feature, input: mark.input, kind: 'item', at }
}

/** The text at a location in the page generated for a feature (`root` is the whole document), if it is shown. */
export function findEditable(root: DocNode, location: TextLocation): EditableText | undefined {
  const visit = (n: DocNode, owner: string | undefined): EditableText | undefined => {
    const own = n.featureInstanceId ?? owner
    if (own === location.feature) {
      for (const [prop, mark] of Object.entries(n.edit ?? {})) {
        if (mark.input !== location.input || mark.kind !== location.kind) continue
        if (mark.kind === 'text') return { node: n, prop }
        if (location.kind === 'text') continue
        if (mark.kind === 'paragraph' && mark.index === location.at) return { node: n, prop }
        const item = mark.kind === 'item' ? mark.entries.indexOf(location.at) : -1
        if (item >= 0) return { node: n, prop, item }
      }
    }
    for (const child of n.children) {
      const found = visit(child, own)
      if (found) return found
    }
    return undefined
  }
  return visit(root, undefined)
}

/** Text typed into a single-line value: line breaks become spaces. */
const oneLine = (text: string) => text.replace(/\s*\n\s*/g, ' ')

/**
 * Text as typed on the page, trimmed. Browsers type non-breaking spaces for trailing and repeated spaces, which would
 * stop the page wrapping there, so they become plain spaces.
 */
const typedText = (text: string) => text.replace(/\u00a0/g, ' ').trim()

/** The non-empty paragraphs of a text with their positions in `text.split(PARAGRAPH_BREAK)`. */
function paragraphSegments(text: string): { segments: string[]; positions: number[] } {
  const segments = text.split(PARAGRAPH_BREAK)
  const positions: number[] = []
  segments.forEach((s, i) => {
    if (i % 2 === 0 && s.trim() !== '') positions.push(i)
  })
  return { segments, positions }
}

/** Removes segment `i` of a split text along with one neighboring break. */
function withoutSegment(segments: string[], i: number): string {
  const out = [...segments]
  if (i + 1 < out.length) out.splice(i, 2)
  else if (i > 0) out.splice(i - 1, 2)
  else out.splice(i, 1)
  return out.join('')
}

/**
 * The input's value with the text at `location` replaced by `text` (trimmed). Emptying a list entry or a paragraph
 * removes it; text that is what the page already shows changes nothing. A paragraph stays one paragraph: blank lines
 * typed or pasted into it become line breaks. Throws `EditError` when the location doesn't exist.
 */
export function editedValue(value: InputValue | undefined, location: TextLocation, text: string, type: InputDef['type']): InputValue {
  const typed = typedText(text)
  if (location.kind === 'text') return typed === asString(value).trim() ? (value ?? '') : type === 'string' ? oneLine(typed) : typed
  if (location.kind === 'item') {
    const items = asList(value)
    if (location.at < 0 || location.at >= items.length) throw new EditError(`Input "${location.input}" has no entry ${location.at}`)
    if (typed === items[location.at]!.trim()) return items
    const entry = oneLine(typed)
    return entry === '' ? items.filter((_, i) => i !== location.at) : items.map((item, i) => (i === location.at ? entry : item))
  }
  const { segments, positions } = paragraphSegments(asString(value))
  const position = positions[location.at]
  if (position === undefined) throw new EditError(`Input "${location.input}" has no paragraph ${location.at}`)
  const paragraph = typed.replace(/\n\s*\n/g, '\n')
  if (paragraph === segments[position]!.trim()) return asString(value)
  if (paragraph === '') return withoutSegment(segments, position)
  return segments.map((s, i) => (i === position ? paragraph : s)).join('')
}

/** The input's value with `text` added as a new entry or paragraph after `location`, and where it went. */
export function insertedValue(value: InputValue | undefined, location: TextLocation, text: string): { value: InputValue; at: number } {
  if (location.kind === 'text') throw new EditError(`Input "${location.input}" holds one text; nothing can be added after it`)
  if (location.kind === 'item') {
    const items = asList(value)
    if (location.at < 0 || location.at >= items.length) throw new EditError(`Input "${location.input}" has no entry ${location.at}`)
    return { value: [...items.slice(0, location.at + 1), oneLine(typedText(text)), ...items.slice(location.at + 1)], at: location.at + 1 }
  }
  const { segments, positions } = paragraphSegments(asString(value))
  const position = positions[location.at]
  if (position === undefined) throw new EditError(`Input "${location.input}" has no paragraph ${location.at}`)
  const out = [...segments]
  out.splice(position + 1, 0, BREAK, typedText(text).replace(/\n\s*\n/g, '\n'))
  return { value: out.join(''), at: location.at + 1 }
}

function locate(model: AppModel, location: TextLocation, options: EditOptions): { value: InputValue | undefined; def: InputDef } {
  const instance = model.features.find((f) => f.id === location.feature)
  if (!instance) throw new EditError(`Feature ${location.feature} does not exist`)
  const feature = (options.registry ?? defaultRegistry).get(instance.feature)
  const def = feature?.inputs.find((i) => i.name === location.input)
  if (!feature || !def) throw new EditError(`Feature ${location.feature} has no input "${location.input}"`)
  return { value: resolveInputs(feature.inputs, instance.inputs)[location.input], def }
}

/**
 * Writes text edited on the page back into the input it came from (see `editedValue`). Returns the same model when
 * nothing changes.
 */
export function editText(model: AppModel, location: TextLocation, text: string, options: EditOptions = {}): AppModel {
  const { value, def } = locate(model, location, options)
  const next = editedValue(value, location, text, def.type)
  if (JSON.stringify(next) === JSON.stringify(value)) return model
  return updateInputs(model, location.feature, { [location.input]: next }, options)
}

/** Adds a list entry or paragraph after `location` (Enter while editing one), and returns where the new one is. */
export function insertTextAfter(model: AppModel, location: TextLocation, text: string, options: EditOptions = {}): { model: AppModel; location: TextLocation } {
  const { value } = locate(model, location, options)
  const inserted = insertedValue(value, location, text)
  return {
    model: updateInputs(model, location.feature, { [location.input]: inserted.value }, options),
    location: { ...location, at: inserted.at } as TextLocation,
  }
}
