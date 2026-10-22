import { BANNER_HEIGHTS, CHART_HEIGHTS } from '@feature-domain/engine'
import { describe, expect, it } from 'vitest'
import {
  aspectHeights,
  imageWidthAt,
  imageWidthBy,
  nearestIndex,
  nearestStep,
  percentWidthAt,
  percentWidthBy,
  scrollRowsAt,
  scrollRowsEstimated,
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

describe('snapping', () => {
  it('keeps the current value until another is clearly nearer, so a boundary does not flicker', () => {
    // Boundary at 260 between 220 and 300.
    expect(nearestIndex([220, 300], 262)).toBe(1)
    expect(nearestIndex([220, 300], 262, 0)).toBe(0)
    expect(nearestIndex([220, 300], 270, 0)).toBe(1)
    expect(nearestStep(CHART_HEIGHTS, 262, 'short')).toBe('short')
    expect(nearestStep(CHART_HEIGHTS, 280, 'short')).toBe('medium')
  })
})

describe('separator width', () => {
  it('is a percentage of the room in steps of 5, from 5 to 100', () => {
    // A centered rule 400 px wide in 800 px, its handle dragged 100 px further out: 600 px, 75%.
    expect(percentWidthAt('center', { left: 200, width: 400 }, 700, 800)).toBe(75)
    expect(percentWidthAt('left', { left: 0, width: 400 }, 333, 1000, true)).toBe(33)
    expect(percentWidthAt('left', { left: 0, width: 400 }, 5000, 1000)).toBe(100)
    expect(percentWidthAt('left', { left: 0, width: 400 }, 0, 1000)).toBe(5)
    expect(percentWidthBy(50, 1)).toBe(55)
    expect(percentWidthBy(50, -1, true)).toBe(49)
    expect(percentWidthBy(50, 1000)).toBe(100)
  })

  it('takes several steps at once for Page Up and the ends', () => {
    expect(imageWidthBy(300, 5, 1000)).toBe(350)
    expect(imageWidthBy(300, -1000, 1000)).toBe(20)
    expect(imageWidthBy(300, 1000, 640)).toBe(640)
  })
})

describe('table Scroll after', () => {
  // Rows as they render: a 40 px header, then rows of different heights (descriptions that wrap).
  const bottoms = [84, 200, 245, 290, 383, 452, 497, 566]

  it('snaps to the nearest real row bottom, at least 3 rows', () => {
    expect(scrollRowsAt(290, bottoms)).toBe(4)
    expect(scrollRowsAt(380, bottoms)).toBe(5)
    expect(scrollRowsAt(100, bottoms)).toBe(3)
  })

  it('keeps the current rows near a boundary', () => {
    // Halfway between rows 5 (383) and 6 (452) is 417.5.
    expect(scrollRowsAt(420, bottoms)).toBe(6)
    expect(scrollRowsAt(420, bottoms, 5)).toBe(5)
  })

  it('shows every row more than half a row past the last one', () => {
    expect(scrollRowsAt(566, bottoms)).toBe(8)
    expect(scrollRowsAt(600, bottoms)).toBe(8)
    expect(scrollRowsAt(602, bottoms)).toBe(0)
    expect(scrollRowsAt(10, [])).toBe(0)
  })

  it('estimates rows while none are loaded', () => {
    expect(scrollRowsEstimated(44 * 9, 44)).toBe(8)
    expect(scrollRowsEstimated(10, 44)).toBe(3)
    expect(scrollRowsEstimated(44 * 200, 44)).toBe(0)
  })

  it('steps a row at a time, with every row one past the last', () => {
    expect(scrollRowsBy(8, 1, 20)).toBe(9)
    expect(scrollRowsBy(20, 1, 20)).toBe(0)
    expect(scrollRowsBy(0, -1, 20)).toBe(20)
    expect(scrollRowsBy(0, 1, 20)).toBe(0)
    expect(scrollRowsBy(3, -1, 20)).toBe(3)
    expect(scrollRowsBy(3, -1000, 20)).toBe(3)
    expect(scrollRowsBy(3, 1000, 20)).toBe(0)
  })

  it('reaches every row from the keyboard past 100 rows too', () => {
    expect(scrollRowsBy(100, 1, 150)).toBe(0)
    expect(scrollRowsBy(0, -1, 150)).toBe(100)
    expect(scrollRowsBy(0, -1, Infinity)).toBe(100)
  })

  it('says the value in words', () => {
    expect(scrollRowsText(0)).toBe('All rows')
    expect(scrollRowsText(8)).toBe('8 rows')
    expect(stepText('tall')).toBe('Tall')
  })
})
