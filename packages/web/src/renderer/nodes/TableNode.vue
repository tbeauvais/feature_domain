<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'
import { computed, onBeforeUnmount, onMounted, onUpdated, ref, useId } from 'vue'
import { badgeKey, badgeTints, cellContent, getPath, NUMERIC_FILTERS, parseFilter } from '../filters'
import SpotEmpty from '../illustrations/SpotEmpty.vue'
import { useTableRows } from '../rows'
import { useTheme } from '../theme'

const props = defineProps<{ node: DocNodeOf<'table'> }>()

const theme = useTheme()
const titleId = `fd-${useId()}`
const { state, reload } = useTableRows(computed(() => props.node.props.source))
const rows = computed(() => (state.value.status === 'loaded' ? state.value.rows : []))

/**
 * Figures (numbers, dates) are right-aligned with tabular digits: by filter, or when every loaded value is a number
 * (so such a column's header moves right when its rows arrive).
 */
const numeric = computed(() =>
  props.node.props.columns.map((column) => {
    const filter = parseFilter(column.filter)?.name
    if (filter !== undefined) return NUMERIC_FILTERS.includes(filter)
    const values = rows.value.map((row) => getPath(row, column.field)).filter((v) => v !== undefined && v !== null && v !== '')
    return values.length > 0 && values.every((v) => typeof v === 'number')
  }),
)

/** Per badge column, each value's tint (first four different values differ). */
const tints = computed(() =>
  props.node.props.columns.map((column) =>
    parseFilter(column.filter)?.name === 'badge' ? badgeTints(rows.value.map((row) => cellContent(row, column.field, column.filter).text)) : undefined,
  ),
)

const count = computed(() => {
  switch (state.value.status) {
    case 'loading':
      return 'Loading rows…'
    case 'error':
      return 'Not loaded'
    case 'loaded':
      return rows.value.length === 1 ? '1 row' : `${rows.value.length} rows`
    default:
      return ''
  }
})

/** Which site failed, so the message says where the problem is. */
const host = computed(() => {
  try {
    return new URL(props.node.props.source?.endPoint ?? '').host
  } catch {
    return ''
  }
})

// A scrolling table shows this many rows before it scrolls; its header stays in view.
const scrollStyle = computed(() => (props.node.props.scrollRows ? { '--table-rows': String(props.node.props.scrollRows) } : undefined))

// The scroll box is a named, focusable region only while it really scrolls (not with fewer rows, at phone width, or
// while loading), so keyboard users don't meet tab stops with nothing to scroll.
const wrap = ref<HTMLElement>()
const overflows = ref(false)
function measure() {
  const el = wrap.value
  overflows.value = Boolean(props.node.props.scrollRows) && el !== undefined && el.scrollHeight > el.clientHeight
}
let observer: ResizeObserver | undefined
onMounted(() => {
  measure()
  if (typeof ResizeObserver === 'undefined' || !wrap.value) return
  observer = new ResizeObserver(measure)
  observer.observe(wrap.value)
  const table = wrap.value.querySelector('table')
  if (table) observer.observe(table)
})
onUpdated(measure)
onBeforeUnmount(() => observer?.disconnect())
const regionLabel = computed(() => (props.node.props.source?.resource ? `${props.node.props.source.resource} table` : 'Table'))
</script>

<template>
  <section class="fd-table-block" :data-fd-table="theme.styles.table" :aria-busy="state.status === 'loading' ? 'true' : undefined">
    <header v-if="node.props.title" class="fd-table-head">
      <p :id="titleId" class="fd-table-title">{{ node.props.title }}</p>
      <span class="fd-table-count">{{ count }}</span>
    </header>
    <div
      ref="wrap"
      class="fd-table-wrap"
      :class="{ 'fd-table-scroll': node.props.scrollRows }"
      :style="scrollStyle"
      :tabindex="overflows ? 0 : undefined"
      :role="overflows ? 'region' : undefined"
      :aria-labelledby="overflows && node.props.title ? titleId : undefined"
      :aria-label="overflows && !node.props.title ? regionLabel : undefined"
    >
      <!-- Explicit roles: at phone width rows are display: block, and some screen readers then stop treating it as a table. -->
      <table class="fd-table" role="table" :aria-labelledby="node.props.title ? titleId : undefined">
        <thead role="rowgroup">
          <tr role="row">
            <th v-for="(column, c) in node.props.columns" :key="column.field" scope="col" role="columnheader" :class="{ 'fd-num': numeric[c] }">{{ column.label }}</th>
          </tr>
        </thead>
        <tbody v-if="state.status === 'loading'" class="fd-table-skeleton" aria-hidden="true">
          <tr v-for="n in 3" :key="n">
            <td v-for="column in node.props.columns" :key="column.field"><span class="fd-skeleton" /></td>
          </tr>
        </tbody>
        <tbody v-else role="rowgroup">
          <tr v-for="(row, index) in rows" :key="index" role="row">
            <td v-for="(column, c) in node.props.columns" :key="column.field" role="cell" :data-label="column.label" :class="{ 'fd-num': numeric[c] }">
              <template v-for="cell in [cellContent(row, column.field, column.filter)]" :key="column.field">
                <a v-if="cell.href" :href="cell.href" target="_blank" rel="noopener noreferrer">{{ cell.text }}</a>
                <span v-else-if="cell.badge" class="fd-badge" :class="`fd-badge-${tints[c]?.get(badgeKey(cell.text)) ?? 0}`">{{ cell.text }}</span>
                <template v-else>{{ cell.text }}</template>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-if="!node.props.source" class="fd-table-note">No data source</p>
    <div v-else-if="state.status === 'error'" class="fd-table-state fd-table-problem" role="alert">
      <p class="fd-table-state-title">Couldn't load rows</p>
      <p class="fd-table-state-text">{{ host ? `${host}: ` : '' }}{{ state.message }}</p>
      <button type="button" class="fd-table-retry" @click="reload()">Try again</button>
    </div>
    <div v-else-if="state.status === 'loaded' && rows.length === 0" class="fd-table-state">
      <span class="fd-table-empty-picture"><SpotEmpty /></span>
      <p class="fd-table-state-title">No rows yet</p>
      <p class="fd-table-state-text">The data source returned an empty list.</p>
    </div>
    <p v-if="!node.props.title && state.status === 'loaded' && rows.length > 0" class="fd-table-foot">{{ count }}</p>
  </section>
</template>
