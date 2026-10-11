<script setup lang="ts">
import { CHART_COLOURS, type DocNodeOf } from '@feature-domain/engine'
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PieController,
  PointElement,
  Tooltip,
  type ChartConfiguration,
} from 'chart.js'
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { chartData } from '../chartData'
import { useTableRows } from '../rows'
import { useTheme } from '../theme'

// Chart.js is bundled with the app (generated pages load nothing from other sites); only what charts use is registered.
Chart.register(PieController, DoughnutController, BarController, LineController, ArcElement, BarElement, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend)

const props = defineProps<{ node: DocNodeOf<'chart'> }>()

const theme = useTheme()
const titleId = `fd-${useId()}`
const { state, reload } = useTableRows(computed(() => props.node.props.source))
const rows = computed(() => (state.value.status === 'loaded' ? state.value.rows : []))
const data = computed(() => chartData(rows.value, props.node.props.labelField, props.node.props.valueField))

/** What screen readers hear for the drawing; the numbers themselves are in the hidden table. */
const label = computed(() => {
  const { description, title, type } = props.node.props
  if (description) return description
  const what = data.value.valueField && data.value.labelField ? `${data.value.valueField} by ${data.value.labelField}` : 'data'
  return `${title ? `${title}: ` : ''}${type} chart of ${what}`
})

const host = computed(() => /^https?:\/\/([^/?#]+)/i.exec(props.node.props.source?.endPoint ?? '')?.[1] ?? '')

const block = ref<HTMLElement>()
const canvas = ref<HTMLCanvasElement>()
let chart: Chart | undefined

/** Colours and type come from the theme tokens on the page around the chart, so every theme draws its own way. */
function config(el: HTMLElement): ChartConfiguration {
  const css = getComputedStyle(el)
  const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  const palette = Array.from({ length: CHART_COLOURS }, (_, i) => token(`--fd-chart-${i}`, '#555555'))
  const text = token('--fd-muted', '#555555')
  const grid = token('--fd-border-subtle', '#dddddd')
  const surface = token('--fd-surface', '#ffffff')
  const font = { family: token('--fd-font-body', 'sans-serif'), size: parseFloat(token('--fd-size-small', '13px')) || 13 }
  const { type } = props.node.props
  const round = type === 'pie' || type === 'donut'
  const values = data.value.values
  const dataset = round
    ? { data: values, backgroundColor: values.map((_, i) => palette[i % palette.length]!), borderColor: surface, borderWidth: 2 }
    : type === 'line'
      ? { data: values, borderColor: palette[0]!, backgroundColor: palette[0]!, pointRadius: 3, tension: 0.25, label: data.value.valueField ?? '' }
      : { data: values, backgroundColor: palette[0]!, borderRadius: 4, maxBarThickness: 48, label: data.value.valueField ?? '' }
  const axis = { ticks: { color: text, font }, grid: { color: grid }, border: { color: grid } }
  return {
    type: type === 'donut' ? 'doughnut' : round ? 'pie' : type === 'line' ? 'line' : 'bar',
    data: { labels: data.value.labels, datasets: [dataset] },
    options: {
      // Calm and deterministic: no animation (screenshots and reduced motion alike).
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: type === 'bar' ? 'y' : 'x',
      color: text,
      font,
      plugins: { legend: { display: round, position: 'bottom', labels: { color: text, font, boxWidth: 12, padding: 14 } }, tooltip: { enabled: true } },
      scales: round ? {} : { x: axis, y: { ...axis, beginAtZero: true } },
    } as ChartConfiguration['options'],
  } as ChartConfiguration
}

let drawing = 0
async function draw() {
  const current = ++drawing
  // Wait for the theme's web fonts, so labels are drawn in them (a canvas never redraws when a font arrives).
  await document.fonts?.ready
  if (current !== drawing || !canvas.value || !block.value) return
  chart?.destroy()
  chart = undefined
  if (data.value.values.length === 0) return
  try {
    chart = new Chart(canvas.value, config(block.value))
  } catch {
    // No canvas support (e.g. in tests): the hidden table still carries the numbers.
  }
}

onMounted(() => void draw())
// Redraw when the data, the chart's settings or the theme change (a canvas doesn't follow CSS on its own).
watch([data, () => props.node.props.type, () => props.node.props.height, theme], () => void draw())
onBeforeUnmount(() => {
  drawing++
  chart?.destroy()
})
</script>

<template>
  <figure ref="block" class="fd-chart-block" :aria-busy="state.status === 'loading' ? 'true' : undefined" :aria-labelledby="node.props.title ? titleId : undefined">
    <figcaption v-if="node.props.title" :id="titleId" class="fd-chart-title">{{ node.props.title }}</figcaption>
    <p v-if="!node.props.source" class="fd-chart-note">No data source</p>
    <div v-else-if="state.status === 'error'" class="fd-chart-state" role="alert">
      <p class="fd-chart-state-title">Couldn't load the data</p>
      <p class="fd-chart-state-text">{{ host ? `${host}: ` : '' }}{{ state.message }}</p>
      <button type="button" class="fd-chart-retry" @click="reload()">Try again</button>
    </div>
    <div v-else-if="state.status === 'loading'" class="fd-chart-skeleton" :style="{ height: `${node.props.height}px` }" aria-hidden="true" />
    <p v-else-if="data.values.length === 0" class="fd-chart-state fd-chart-state-text">
      {{ rows.length === 0 ? 'No rows to chart yet.' : `No numbers to chart${data.valueField ? ` in "${data.valueField}"` : ''}.` }}
    </p>
    <div v-show="state.status === 'loaded' && data.values.length > 0" class="fd-chart-canvas" :style="{ height: `${node.props.height}px` }">
      <canvas ref="canvas" role="img" :aria-label="label" />
    </div>
    <!-- The numbers for screen readers. A div does the hiding: overflow does not clip a table box itself. -->
    <div v-if="data.values.length > 0" class="fd-visually-hidden">
      <table class="fd-chart-data">
        <caption>{{ label }}</caption>
        <thead>
          <tr>
            <th scope="col">{{ data.labelField ?? 'Item' }}</th>
            <th scope="col">{{ data.valueField ?? 'Value' }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(value, i) in data.values" :key="i">
            <th scope="row">{{ data.labels[i] }}</th>
            <td>{{ value }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </figure>
</template>
