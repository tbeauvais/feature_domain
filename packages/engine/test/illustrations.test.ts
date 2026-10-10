import { describe, expect, it } from 'vitest'
import { ILLUSTRATIONS, illustrationInfo, isIllustrationId } from '../src'

describe('ILLUSTRATIONS', () => {
  it('has unique ids of the form <kind>/<name>', () => {
    const ids = ILLUSTRATIONS.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const i of ILLUSTRATIONS) expect(i.id).toMatch(new RegExp(`^${i.kind}/[a-z-]+$`))
  })

  it('describes every picture for screen readers; dividers are decorative', () => {
    for (const i of ILLUSTRATIONS) expect(i.alt === '', i.id).toBe(i.kind === 'divider')
  })

  it('has a positive aspect ratio for each', () => {
    for (const i of ILLUSTRATIONS) expect(i.aspect).toBeGreaterThan(0)
  })

  it('looks illustrations up by id', () => {
    expect(illustrationInfo('spot/map')?.name).toBe('Map')
    expect(illustrationInfo('spot/nope')).toBeUndefined()
    expect(isIllustrationId('banner/shapes')).toBe(true)
    expect(isIllustrationId('shapes')).toBe(false)
  })
})
