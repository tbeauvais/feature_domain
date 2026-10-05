import { describe, expect, it } from 'vitest'
import { generate, isAppModel, migrate, validateModel } from '../src'
import { at, inst, model, page } from './helpers'

describe('validateModel', () => {
  it('accepts valid models, including every migrated sample', () => {
    expect(validateModel(model(page(), inst('TextFeature', 't', { text: 'x', size: 3, on: true, list: ['a'] }), { ...inst('ContainerFeature', 'c'), cache: { a: 1 } }))).toEqual([])
    expect(isAppModel(migrate([{ feature: 'PageFeature', id: 1, inputs: { page_location: { target: '#content_section' } } }]).model)).toBe(true)
  })

  it('describes every structural problem', () => {
    expect(validateModel(null)).toEqual(['Model is not an object'])
    expect(validateModel({ version: 2, name: 'Malformed' })).toEqual(['Model has no features list'])
    expect(
      validateModel({
        version: 1,
        name: 3,
        id: 4,
        features: [
          'x',
          { feature: 'TextFeature', id: 1, inputs: [] },
          { feature: 'TextFeature', id: 'a', inputs: { o: { nested: true }, l: [1] }, placement: { parent: 'p' }, cache: 'c' },
          { id: 'b', inputs: {}, placement: at('1', 'content') },
        ],
      }),
    ).toEqual([
      'Unsupported model version 1',
      'Model name is not a string',
      'Model id is not a string',
      'Feature 0 is not an object',
      'Feature 1 has no string id',
      'Feature 1 has no inputs object',
      'Feature 2 input "o" is not a string, number, boolean or string list',
      'Feature 2 input "l" is not a string, number, boolean or string list',
      'Feature 2 has an invalid placement',
      'Feature 2 has an invalid cache',
      'Feature 3 has no feature type',
    ])
  })

  it('guards generate: valid models never make it throw', () => {
    const valid = model(page(), inst('TextFeature', 't'))
    expect(isAppModel(valid)).toBe(true)
    expect(() => generate(valid)).not.toThrow()
  })
})
