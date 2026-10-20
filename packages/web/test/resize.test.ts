import { BANNER_HEIGHTS, CHART_HEIGHTS } from '@feature-domain/engine'
import { describe, expect, it } from 'vitest'
import {
  aspectHeights,
  imageWidthAt,
  imageWidthBy,
  nearestStep,
  scrollRowsAt,
  scrollRowsBy,
  scrollRowsText,
  sharesText,
  stepBy,
  stepText,
  trackFraction,
} from '../src/editor/resize'

describe('height steps', () => {
  it('picks the step nearest the dragged height', () => {
    expect(nearestStep(CHART_HEIGHTS, 0)).toBe('short')
    expect(nearestStep(CHART_HEIGHTS, 259)).toBe('short')
    expect(nearestStep(CHART_HEIGHTS, 261)).toBe('medium')
    expect(nearestStep(CHART_HEIGHTS, 351)).toBe('tall')
    expect(nearestStep(CHART_HEIGHTS, 9000)).toBe('tall')
  })

  it('turns width / height shapes into heights at a width', () => {
    // A 960 px banner: short 160, medium 240, tall 300.
    expect(aspectHeights(BANNER_HEIGHTS, 960)).toEqual({ short: 160, medium: 240, tall: 300 })
    expect(nearestStep(aspectHeights(BANNER_HEIGHTS, 960), 280)).toBe('tall')
    expect(nearestStep(aspectHeights(BANNER_HEIGHTS, 960), 190)).toBe('short')
  })

  it('steps with the arrow keys and stays at the ends', () => {
    const order = ['short', 'medium', 'tall']
    expect(stepBy(order, 'medium', 1)).toBe('tall')
    expect(stepBy(order, 'tall', 1)).toBe('tall')
    expect(stepBy(order, 'short', -1)).toBe('short')
    // An unrecognized stored value counts as the first step.
    expect(stepBy(order, 'huge', 1)).toBe('medium')
  })
})

describe('image width', () => {
  const box = { left: 100, width: 300 }

  it('follows the handle on the right edge of a left-aligned image, in steps of 10 px', () => {
    expect(imageWidthAt('left', box, 424, 1000)).toBe(320)
    expect(imageWidthAt('left', box, 424, 1000, true)).toBe(324)
  })

  it('follows the left edge of a right-aligned image, and both edges of a centered one', () => {
    expect(imageWidthAt('right', box, 50, 1000)).toBe(350)
    // Center 250: a handle at 420 is 170 px out, so 340 wide.
    expect(imageWidthAt('center', box, 420, 1000)).toBe(340)
  })

  it('stays between 20 px and the space the image has', () => {
    expect(imageWidthAt('left', box, 90, 1000)).toBe(20)
    expect(imageWidthAt('left', box, 2000, 643.5)).toBe(643)
    expect(imageWidthAt('left', box, 2000, 5)).toBe(20)
  })

  it('steps with the arrow keys from the nearest step', () => {
    expect(imageWidthBy(300, 1, 1000)).toBe(310)
    expect(imageWidthBy(304, 1, 1000)).toBe(310)
    expect(imageWidthBy(304, -1, 1000)).toBe(300)
    expect(imageWidthBy(300, -1, 1000, true)).toBe(299)
    expect(imageWidthBy(640, 1, 643)).toBe(643)
  })
})

describe('column edges', () => {
  it('measures along the columns without the gaps', () => {
    // Two columns of 190 px with a 20 px gap from x = 0: the edge sits in the gap at 200, half the columns.
    expect(trackFraction(200, { left: 0, width: 400 }, 20, 2, 1)).toBe(0.5)
    // Three columns of 120 px with 20 px gaps: the second edge, mid-gap at 270, is two thirds of the columns.
    expect(trackFraction(270, { left: 0, width: 400 }, 20, 3, 2)).toBeCloseTo(2 / 3)
    expect(trackFraction(10, { left: 0, width: 20 }, 20, 2, 1)).toBeNaN()
  })

  it('says the widths as shares', () => {
    expect(sharesText([2, 1])).toBe('2 : 1')
  })
})

describe('table Scroll after', () => {
  // Rows of 44 px: the box is the header and that many rows.
  it('snaps to whole rows, at least 3', () => {
    expect(scrollRowsAt(44 * 9, 44, 20)).toBe(8)
    expect(scrollRowsAt(44 * 9 + 20, 44, 20)).toBe(8)
    expect(scrollRowsAt(10, 44, 20)).toBe(3)
  })

  it('shows every row past the rows loaded', () => {
    expect(scrollRowsAt(44 * 21, 44, 20)).toBe(20)
    expect(scrollRowsAt(44 * 22, 44, 20)).toBe(0)
    expect(scrollRowsAt(44 * 4, 44, 2)).toBe(0)
    // Rows shorter than the estimate: half a row past the content's bottom is enough.
    expect(scrollRowsAt(280, 44, 6, 266)).toBe(5)
    expect(scrollRowsAt(290, 44, 6, 266)).toBe(0)
  })

  it('steps a row at a time, with every row one past the last', () => {
    expect(scrollRowsBy(8, 1, 20)).toBe(9)
    expect(scrollRowsBy(20, 1, 20)).toBe(0)
    expect(scrollRowsBy(0, -1, 20)).toBe(20)
    expect(scrollRowsBy(0, 1, 20)).toBe(0)
    expect(scrollRowsBy(3, -1, 20)).toBe(3)
    expect(scrollRowsBy(0, -1, 2)).toBe(0)
  })

  it('says the value in words', () => {
    expect(scrollRowsText(0)).toBe('All rows')
    expect(scrollRowsText(8)).toBe('8 rows')
    expect(stepText('tall')).toBe('Tall')
  })
})
