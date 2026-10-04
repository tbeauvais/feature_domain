import { describe, expect, it } from 'vitest'
import { buildGraph, dependentsOf, topoSort } from '../src'

describe('buildGraph', () => {
  it('ignores edges to unknown nodes and duplicate edges', () => {
    const g = buildGraph(['a', 'b'], [['a', 'b'], ['a', 'b'], ['a', 'x'], ['x', 'b']])
    expect(g.children.get('a')).toEqual(['b'])
    expect(g.parents.get('b')).toEqual(['a'])
  })
})

describe('topoSort', () => {
  it('orders parents before dependents', () => {
    const g = buildGraph(['child', 'parent'], [['parent', 'child']])
    expect(topoSort(g).order).toEqual(['parent', 'child'])
  })

  it('keeps model order among independent nodes', () => {
    const g = buildGraph(['c', 'a', 'b'], [])
    expect(topoSort(g).order).toEqual(['c', 'a', 'b'])
  })

  it('picks the earliest ready node in model order', () => {
    // d depends on a; b and c are free. a, then b (earlier than d), then c, then d.
    const g = buildGraph(['a', 'd', 'b', 'c'], [['a', 'd']])
    expect(topoSort(g).order).toEqual(['a', 'd', 'b', 'c'])
  })

  it('reports nodes on a cycle separately from nodes blocked behind it', () => {
    const g = buildGraph(['a', 'b', 'c', 'free'], [['a', 'b'], ['b', 'a'], ['b', 'c']])
    expect(topoSort(g)).toEqual({ order: ['free'], cyclic: ['a', 'b'], blocked: ['c'] })
  })

  it('treats a self edge as a cycle', () => {
    const g = buildGraph(['a'], [['a', 'a']])
    expect(topoSort(g).cyclic).toEqual(['a'])
  })
})

describe('dependentsOf', () => {
  it('returns transitive dependents in model order, excluding the node itself', () => {
    const g = buildGraph(['a', 'b', 'c', 'd', 'e'], [['a', 'c'], ['c', 'b'], ['b', 'd']])
    expect(dependentsOf(g, 'a')).toEqual(['b', 'c', 'd'])
    expect(dependentsOf(g, 'b')).toEqual(['d'])
    expect(dependentsOf(g, 'e')).toEqual([])
  })

  it('terminates on cycles', () => {
    const g = buildGraph(['a', 'b'], [['a', 'b'], ['b', 'a']])
    expect(dependentsOf(g, 'a')).toEqual(['b'])
  })
})
