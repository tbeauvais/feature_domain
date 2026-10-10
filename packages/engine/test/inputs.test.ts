import { describe, expect, it } from 'vitest'
import {
  asAlign,
  asBool,
  asInt,
  asList,
  asString,
  asOneOf,
  createFeatureInstance,
  DataResourceFeature,
  defaultInputs,
  ImageFeature,
  initialInputs,
  isInputShown,
  resolveInputs,
  TextFeature,
  type InputDef,
} from '../src'
import { deepFreeze } from './helpers'

const defs: InputDef[] = [
  { name: 'text', label: 'Text', type: 'string', default: 'hello', control: 'text-input' },
  { name: 'flag', label: 'Flag', type: 'boolean', default: false, control: 'checkbox-input' },
  { name: 'plain', label: 'Plain', type: 'string', control: 'text-input' },
]

describe('defaultInputs', () => {
  it('includes only inputs that declare a default', () => {
    expect(defaultInputs(defs)).toEqual({ text: 'hello', flag: false })
  })
})

describe('initialInputs', () => {
  const withInitial: InputDef[] = [...defs, { name: 'source', label: 'Source', type: 'string', default: 'link', initial: 'illustration', control: 'text-input' }]

  it('gives new instances the initial value, while absent stored inputs still read as the default', () => {
    expect(initialInputs(withInitial)).toEqual({ text: 'hello', flag: false, source: 'illustration' })
    expect(defaultInputs(withInitial)).toEqual({ text: 'hello', flag: false, source: 'link' })
    expect(resolveInputs(withInitial, {})).toMatchObject({ source: 'link' })
  })
})

describe('isInputShown', () => {
  const shown: InputDef[] = [
    { name: 'source', label: 'Source', type: 'string', default: 'link', control: 'text-input' },
    { name: 'src', label: 'Address', type: 'string', control: 'text-input', showWhen: { input: 'source', equals: 'link' } },
  ]

  it('shows inputs without a condition, and conditional ones only while the other input has the value', () => {
    expect(isInputShown(shown[0]!, shown, {})).toBe(true)
    expect(isInputShown(shown[1]!, shown, { source: 'link' })).toBe(true)
    expect(isInputShown(shown[1]!, shown, { source: 'illustration' })).toBe(false)
  })

  it('needs every condition to hold, and any of several listed values matches', () => {
    const both: InputDef = { name: 'h', label: 'H', type: 'string', control: 'text-input', showWhen: [
      { input: 'source', equals: 'illustration' },
      { input: 'kind', equals: ['a', 'b'] },
    ] }
    const all = [...shown, { name: 'kind', label: 'Kind', type: 'string', control: 'text-input' } as InputDef, both]
    expect(isInputShown(both, all, { source: 'illustration', kind: 'b' })).toBe(true)
    expect(isInputShown(both, all, { source: 'illustration', kind: 'c' })).toBe(false)
    expect(isInputShown(both, all, { source: 'link', kind: 'a' })).toBe(false)
  })

  it('matches any other value with notEquals', () => {
    const other: InputDef = { name: 'o', label: 'O', type: 'string', control: 'text-input', showWhen: { input: 'source', notEquals: 'illustration' } }
    const all = [...shown, other]
    expect(isInputShown(other, all, { source: 'link' })).toBe(true)
    expect(isInputShown(other, all, { source: 'something-new' })).toBe(true)
    expect(isInputShown(other, all, { source: 'illustration' })).toBe(false)
  })

  it('reads an absent controlling input as its default', () => {
    expect(isInputShown(shown[1]!, shown, {})).toBe(true)
  })
})

describe('resolveInputs', () => {
  it('fills defaults for absent inputs and keeps stored values, including empty ones', () => {
    expect(resolveInputs(defs, { flag: true, text: '', extra: 1 })).toEqual({ text: '', flag: true, extra: 1 })
    expect(resolveInputs(defs, { text: undefined })).toEqual({ text: 'hello', flag: false })
  })

  it('does not mutate its argument', () => {
    expect(() => resolveInputs(defs, deepFreeze({ flag: true }))).not.toThrow()
  })
})

describe('createFeatureInstance', () => {
  it('uses initial values, so a new Image starts as an illustration', () => {
    expect(createFeatureInstance(ImageFeature, '3').inputs).toMatchObject({ source: 'illustration', illustration: 'banner/blueprint', responsive: true })
  })

  it('creates a placed instance with default inputs', () => {
    const placement = { parent: '1', slot: 'content' }
    const instance = createFeatureInstance(TextFeature, '9', placement)
    expect(instance).toEqual({
      feature: 'TextFeature',
      id: '9',
      inputs: { name: 'untitled', disable: false, text: 'Say what this part of the page is about in a sentence or two.' },
      placement,
    })
    expect(instance.placement).not.toBe(placement)
  })

  it('never places features that are not placeable', () => {
    expect(createFeatureInstance(DataResourceFeature, 'r', { parent: '1', slot: 'content' }).placement).toBeUndefined()
  })
})

describe('coercion', () => {
  it('treats only boolean true as true', () => {
    expect([true, 'true', 1, false, undefined].map(asBool)).toEqual([true, false, false, false, false])
  })

  it('parses integers with a fallback', () => {
    expect(asInt('3', 1)).toBe(3)
    expect(asInt(4.7, 1)).toBe(4)
    expect(asInt('abc', 1)).toBe(1)
  })

  it('reads strings, lists, alignments and choices', () => {
    expect(asString(5)).toBe('5')
    expect(asString({}, 'x')).toBe('x')
    expect(asList(['a', 1])).toEqual(['a', '1'])
    expect(asList('a,b')).toEqual([])
    expect(asAlign('right', 'left')).toBe('right')
    expect(asAlign('pull-right', 'left')).toBe('left')
    expect(asOneOf('band', ['none', 'tint', 'band'], 'none')).toBe('band')
    expect(asOneOf('info', ['none', 'tint', 'band'], 'none')).toBe('none')
    expect(asOneOf('constructor', ['none', 'tint'], 'none')).toBe('none')
  })
})
