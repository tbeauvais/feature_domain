<script setup lang="ts">
import { columnsFromRows, withInputs, type DocNodeOf } from '@feature-domain/engine'
import { computed, nextTick, onBeforeUnmount, onMounted, onUpdated, ref, shallowRef, useId } from 'vue'
import { badgeKey, badgeTints, cellContent, getPath, NUMERIC_FILTERS, parseFilter } from '../filters'
import SpotEmpty from '../illustrations/SpotEmpty.vue'
import { NotSentFromEditor, useDataStore } from '../data'
import { useTableRows } from '../rows'
import { useTheme } from '../theme'

const props = defineProps<{ node: DocNodeOf<'table'> }>()

const theme = useTheme()
const titleId = `fd-${useId()}`
const { state, reload } = useTableRows(computed(() => props.node.props.source))
const rows = computed(() => (state.value.status === 'loaded' ? state.value.rows : []))
/**
 * The columns to show: the table's own, else one per key of the loaded rows (e.g. a response no spec describes), with
 * the table's Labels and Filters in order.
 */
const columns = computed(() => {
  if (props.node.props.columns.length > 0) return props.node.props.columns
  const byPosition = props.node.props.byPosition
  return byPosition ? withInputs(columnsFromRows(rows.value), byPosition.labels, byPosition.filters) : columnsFromRows(rows.value)
})

// Row delete (legacy tables had a Delete button per row): asked inline first ("Delete this row?"), since a deleted row
// is gone from a real API; on sample data only rows a form added can go.
const store = useDataStore()
/**
 * The delete action, with its column: on an address always (so it doesn't come and go while rows reload), on sample
 * data only once a form has added a row (the model's own rows can't go).
 */
const deleteAction = computed(() => {
  const action = props.node.props.deleteAction
  return action && (!action.sample || rows.value.some((row) => store.canDelete(action, row))) ? action : undefined
})
// shallowRef: rows are compared by identity, and ref() would wrap them in a proxy.
const confirming = shallowRef<unknown>(undefined)
const deleting = ref(false)
const deleteProblem = ref('')

// Keyboard focus follows the buttons as they swap: to Delete in the question, back to the row's Delete after Keep,
// and to the next row's (else the previous one's, else the table) after deleting.
const block = ref<HTMLElement>()
const focusLater = (selector: string) => nextTick(() => wrap.value?.querySelector<HTMLElement>(selector)?.focus())
function ask(row: unknown) {
  deleteProblem.value = ''
  confirming.value = row
  void focusLater('.fd-table-action-danger')
}
function keep(index: number) {
  deleteProblem.value = ''
  confirming.value = undefined
  void focusLater(`[data-delete-row="${index}"]`)
}
async function deleteRow(row: unknown, index: number) {
  if (!deleteAction.value || deleting.value) return
  deleting.value = true
  deleteProblem.value = ''
  try {
    await store.delete(deleteAction.value, row)
    confirming.value = undefined
    await nextTick()
    const next = wrap.value?.querySelector<HTMLElement>(`[data-delete-row="${index}"]`) ?? wrap.value?.querySelector<HTMLElement>(`[data-delete-row="${index - 1}"]`)
    ;(next ?? block.value)?.focus()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    deleteProblem.value = error instanceof NotSentFromEditor ? message : `Couldn't delete the row: ${message}`
  } finally {
    deleting.value = false
  }
}

/**
 * Figures (numbers, dates) are right-aligned with tabular digits: by filter, or when every loaded value is a number
 * (so such a column's header moves right when its rows arrive).
 */
const numeric = computed(() =>
  columns.value.map((column) => {
    const filter = parseFilter(column.filter)?.name
    if (filter !== undefined) return NUMERIC_FILTERS.includes(filter)
    const values = rows.value.map((row) => getPath(row, column.field)).filter((v) => v !== undefined && v !== null && v !== '')
    return values.length > 0 && values.every((v) => typeof v === 'number')
  }),
)

/** Per badge column, each value's tint (first four different values differ). */
const tints = computed(() =>
  columns.value.map((column) =>
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
  <!-- tabindex -1: where focus goes after deleting the last row that had a Delete button (not a tab stop). -->
  <section ref="block" class="fd-table-block" tabindex="-1" :data-fd-table="theme.styles.table" :aria-busy="state.status === 'loading' ? 'true' : undefined">
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
            <th v-for="(column, c) in columns" :key="column.field" scope="col" role="columnheader" :class="{ 'fd-num': numeric[c] }">{{ column.label }}</th>
            <th v-if="deleteAction" scope="col" role="columnheader" class="fd-table-actions"><span class="fd-visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody v-if="state.status === 'loading'" class="fd-table-skeleton" aria-hidden="true">
          <tr v-for="n in 3" :key="n">
            <td v-for="column in columns" :key="column.field"><span class="fd-skeleton" /></td>
            <td v-if="deleteAction" class="fd-table-actions" />
          </tr>
        </tbody>
        <tbody v-else role="rowgroup">
          <tr v-for="(row, index) in rows" :key="index" role="row">
            <td v-for="(column, c) in columns" :key="column.field" role="cell" :data-label="column.label" :class="{ 'fd-num': numeric[c] }">
              <template v-for="cell in [cellContent(row, column.field, column.filter)]" :key="column.field">
                <a v-if="cell.href" :href="cell.href" target="_blank" rel="noopener noreferrer">{{ cell.text }}</a>
                <span v-else-if="cell.badge" class="fd-badge" :class="`fd-badge-${tints[c]?.get(badgeKey(cell.text)) ?? 0}`">{{ cell.text }}</span>
                <template v-else>{{ cell.text }}</template>
              </template>
            </td>
            <td v-if="deleteAction" role="cell" class="fd-table-actions" data-label="">
              <template v-if="store.canDelete(deleteAction, row)">
                <span v-if="confirming === row" class="fd-table-confirm">
                  <span>Delete this row?</span>
                  <button type="button" class="fd-table-action fd-table-action-danger" :disabled="deleting" @click="deleteRow(row, index)">Delete</button>
                  <button type="button" class="fd-table-action" :disabled="deleting" @click="keep(index)">Keep</button>
                </span>
                <button v-else type="button" class="fd-table-action" :data-delete-row="index" :aria-label="`Delete row ${index + 1}`" @click="ask(row)">Delete</button>
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
      <button type="button" class="fd-retry fd-table-retry" @click="reload()">Try again</button>
    </div>
    <div v-else-if="state.status === 'loaded' && rows.length === 0" class="fd-table-state">
      <span class="fd-table-empty-picture"><SpotEmpty /></span>
      <p class="fd-table-state-title">No rows yet</p>
      <p class="fd-table-state-text">The data source returned an empty list.</p>
    </div>
    <p v-if="deleteProblem" class="fd-table-note fd-table-delete-problem" role="alert">{{ deleteProblem }}</p>
    <p v-if="!node.props.title && state.status === 'loaded' && rows.length > 0" class="fd-table-foot">{{ count }}</p>
  </section>
</template>
