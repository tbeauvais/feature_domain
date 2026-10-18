import { generate, type AppModel } from '@feature-domain/engine'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DocumentView from '../src/renderer/DocumentView.vue'
import { inst, model, page } from './helpers'

// A stand-in Chart.js that counts what the component asks of it.
const calls = vi.hoisted(() => ({ created: 0, updated: 0, destroyed: 0, leftover: 0 }))
vi.mock('chart.js', () => {
  class Chart {
    static register() {}
    static getChart() {
      return calls.leftover > 0 ? { destroy: () => calls.leftover-- } : undefined
    }
    data: unknown
    constructor(_canvas: unknown, config: { data: unknown }) {
      if (calls.leftover > 0) throw new Error('Canvas is already in use')
      calls.created++
      this.data = config.data
    }
    update() {
      calls.updated++
    }
    destroy() {
      calls.destroyed++
    }
  }
  const element = class {}
  return {
    Chart,
    ArcElement: element,
    BarController: element,
    BarElement: element,
    CategoryScale: element,
    DoughnutController: element,
    Legend: element,
    LinearScale: element,
    LineController: element,
    LineElement: element,
    PieController: element,
    PointElement: element,
    Tooltip: element,
  }
})

beforeEach(() => Object.assign(calls, { created: 0, updated: 0, destroyed: 0, leftover: 0 }))

const rows = (n: number) =>
  JSON.stringify([
    { region: 'North', sales: n },
    { region: 'South', sales: 3 },
  ])
const pageModel = (inputs: { text?: string; sales?: number; chart_type?: string }) =>
  model(
    inst('ThemeFeature', 'th', {}, null),
    inst('DataResourceFeature', 'r', { name: 'Sales', source: 'sample', sample_rows: rows(inputs.sales ?? 5) }, null),
    page({ theme: 'th' }),
    inst('TextFeature', 't', { text: inputs.text ?? 'Hello' }),
    inst('GoogleChartFeature', 'c', { data_resource: 'r', chart_type: inputs.chart_type ?? 'column' }),
  )

async function render(m: AppModel) {
  const w = mount(DocumentView, { props: { root: generate(m).root } })
  await vi.dynamicImportSettled()
  await flushPromises()
  return {
    w,
    regenerate: async (next: AppModel) => {
      await w.setProps({ root: generate(next).root })
      await flushPromises()
    },
  }
}

describe('ChartNode redrawing', () => {
  it('leaves the chart alone when something else on the page changes, though generation makes new objects', async () => {
    const { regenerate } = await render(pageModel({}))
    expect(calls).toMatchObject({ created: 1, updated: 0 })
    await regenerate(pageModel({ text: 'Hello there' }))
    await regenerate(pageModel({ text: 'Hello there!' }))
    expect(calls).toMatchObject({ created: 1, updated: 0, destroyed: 0 })
  })

  it('updates the chart in place when only its numbers change, and rebuilds it when its look changes', async () => {
    const { regenerate } = await render(pageModel({}))
    await regenerate(pageModel({ sales: 9 }))
    expect(calls).toMatchObject({ created: 1, updated: 1, destroyed: 0 })
    await regenerate(pageModel({ sales: 9, chart_type: 'pie' }))
    expect(calls).toMatchObject({ created: 2, destroyed: 1 })
  })

  it('clears a chart Chart.js still holds on the canvas, so a failed draw cannot block the next', async () => {
    calls.leftover = 1
    await render(pageModel({}))
    // The leftover was destroyed before drawing, so the new chart could be made.
    expect(calls).toMatchObject({ leftover: 0, created: 1 })
  })
})
