import { describe, expect, it } from 'vitest'
import {
  asBool,
  asInt,
  asString,
  createFeatureInstance,
  defaultInputs,
  instanceDomId,
  normalizeTarget,
  pageLocation,
  TextFeature,
  type InputDef,
} from '../src'
import { normalizeAlign, normalizeTone } from '../src/features/legacy'

describe('defaultInputs', () => {
  const defs: InputDef[] = [
    { name: 'text', label: 'Text', type: 'string', default: 'hello', control: 'text-input' },
    { name: 'flag', label: 'Flag', type: 'boolean', default: false, control: 'checkbox-input' },
    { name: 'plain', label: 'Plain', type: 'string', control: 'text-input' },
  ]

  it('includes only inputs that declare a default', () => {
    expect(defaultInputs(defs)).toEqual({ text: 'hello', flag: false })
  })
})

describe('createFeatureInstance', () => {
  it('creates an instance with default inputs at the given location', () => {
    const location = { name: 'Page 1', target: '#page_container' }
    const instance = createFeatureInstance(TextFeature, '9', location)
    expect(instance).toEqual({
      feature: 'TextFeature',
      id: '9',
      inputs: {
        name: 'untitled',
        disable: false,
        text: 'Lorem ipsum dolor sit amet, consectetur adipisicing elit',
        page_location: location,
      },
    })
    expect(instance.inputs.page_location).not.toBe(location)
  })
})

describe('coercion', () => {
  it('reads legacy boolean encodings', () => {
    expect([true, 'true', false, 'false', '', undefined].map(asBool)).toEqual([true, true, false, false, false, false])
  })

  it('parses integers with a fallback', () => {
    expect(asInt('3', 1)).toBe(3)
    expect(asInt(4.7, 1)).toBe(4)
    expect(asInt('abc', 1)).toBe(1)
    expect(asInt(undefined, 2)).toBe(2)
  })

  it('stringifies scalars and falls back for objects', () => {
    expect(asString(5)).toBe('5')
    expect(asString({}, 'x')).toBe('x')
  })
})

describe('pageLocation', () => {
  it('defaults the page name', () => {
    expect(pageLocation({ page_location: { target: '#a' } })).toEqual({ name: 'Page 1', target: '#a' })
  })

  it('returns undefined when there is no usable target', () => {
    expect(pageLocation({})).toBeUndefined()
    expect(pageLocation({ page_location: { name: 'Page 1', target: ' ' } })).toBeUndefined()
  })
})

describe('ids', () => {
  it('derives DOM ids the same way as the legacy app', () => {
    expect(instanceDomId('12', { name: 'My  Container' })).toBe('my_container_12')
    expect(instanceDomId('3', {})).toBe('untitled_3')
  })

  it('strips the legacy # from targets', () => {
    expect(normalizeTarget(' #page_container')).toBe('page_container')
    expect(normalizeTarget('page_container')).toBe('page_container')
  })
})

describe('legacy value mapping', () => {
  it('maps Bootstrap alignment classes to plain values', () => {
    expect(['pull-left', 'text-center', 'center-block', 'pull-right', 'right'].map((v) => normalizeAlign(v, 'left'))).toEqual([
      'left',
      'center',
      'center',
      'right',
      'right',
    ])
    expect(normalizeAlign('bogus', 'center')).toBe('center')
  })

  it('maps Bootstrap text and background classes to tones', () => {
    expect(normalizeTone('text-info')).toBe('info')
    expect(normalizeTone('bg-danger')).toBe('danger')
    expect(normalizeTone('warning')).toBe('warning')
    expect(normalizeTone('')).toBeUndefined()
    expect(normalizeTone('text-bogus')).toBeUndefined()
  })
})
