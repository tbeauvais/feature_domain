import { describe, expect, it } from 'vitest'
import {
  asAlign,
  asBool,
  asInt,
  asList,
  asString,
  asTone,
  createFeatureInstance,
  DataResourceFeature,
  defaultInputs,
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
  it('creates a placed instance with default inputs', () => {
    const placement = { parent: '1', slot: 'content' }
    const instance = createFeatureInstance(TextFeature, '9', placement)
    expect(instance).toEqual({
      feature: 'TextFeature',
      id: '9',
      inputs: { name: 'untitled', disable: false, text: 'Lorem ipsum dolor sit amet, consectetur adipisicing elit' },
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

  it('reads strings, lists, alignments and tones', () => {
    expect(asString(5)).toBe('5')
    expect(asString({}, 'x')).toBe('x')
    expect(asList(['a', 1])).toEqual(['a', '1'])
    expect(asList('a,b')).toEqual([])
    expect(asAlign('right', 'left')).toBe('right')
    expect(asAlign('pull-right', 'left')).toBe('left')
    expect(asTone('info')).toBe('info')
    expect(asTone('text-info')).toBeUndefined()
  })
})
