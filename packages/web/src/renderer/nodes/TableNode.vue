<script setup lang="ts">
import { columnsFromRows, withInputs, type DataAction, type DocNodeOf } from '@feature-domain/engine'
import { computed, nextTick, onBeforeUnmount, onMounted, onUpdated, ref, shallowRef, useId, watchEffect } from 'vue'
import { badgeKey, badgeTints, cellContent, getPath, NUMERIC_FILTERS, parseFilter } from '../filters'
import SpotEmpty from '../illustrations/SpotEmpty.vue'
import { NotSentFromEditor, useDataStore } from '../data'
import { useTableRows } from '../rows'
import { scrollFit } from '../tableFit'
import { useTheme } from '../theme'
import { opensNewTab } from '../urls'

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
 * The delete action, with its column: on an address whose rows the visitor may all delete, always (so it doesn't come
 * and go while rows reload); otherwise once a row can go: on sample data a row a form added (the model's own rows
 * can't go), on a published app's table a row its rule lets the visitor delete (under Owner, their own).
 */
const deleteAction = computed<DataAction | undefined>((before) => {
  const action = props.node.props.deleteAction
  if (!action) return undefined
  if (!action.sample && store.allows(action) === 'yes') return action
  // While rows reload the column stays as it was, so the table doesn't reflow.
  if (state.value.status === 'loading' && before === action) return before
  return rows.value.some((row) => store.canDelete(action, row)) ? action : undefined
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
    const next =
      wrap.value?.querySelector<HTMLElement>(`[data-delete-row="${index}"]`) ?? wrap.value?.querySelector<HTMLElement>(`[data-delete-row="${index - 1}"]`)
    ;(next ?? block.value)?.focus()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    deleteProblem.value = error instanceof NotSentFromEditor ? message : `Couldn't delete the row: ${message}`
  } finally {
    deleting.value = false
  }
}

// Changing a row in place: a column with options is a select per row, sent as that one field (the Change Operation).
// The rows stay on show while they reload, so the select keeps keyboard focus; a change that fails is put back.
const updateAction = computed(() => props.node.props.updateAction)
/** Per row, whether its cells can be changed: the table's rule lets the visitor (on a published app; under Owner, their own rows). */
const changeable = computed(() => rows.value.map((row) => !!updateAction.value && store.allows(updateAction.value, row) === 'yes'))
// Who is signed in, checked where a rule needs it (on a published app).
watchEffect(() => {
  store.checkVisitorFor(props.node.props.deleteAction)
  store.checkVisitorFor(updateAction.value)
})

/** The cells being sent (`<row index>:<field>`); each select is busy on its own, so other rows can change meanwhile. */
const changing = ref(new Set<string>())
const changeProblem = ref('')
/** A cell's value as its select shows it. */
const chosen = (row: unknown, field: string) => {
  const value = getPath(row, field)
  return value === undefined || value === null ? '' : String(value)
}
/** A picked option as the row holds that field: a number or yes/no stays one (options are text). */
function typed(picked: string, before: unknown): unknown {
  if (typeof before === 'number' && picked.trim() !== '' && Number.isFinite(Number(picked))) return Number(picked)
  if (typeof before === 'boolean' && (picked === 'true' || picked === 'false')) return picked === 'true'
  return picked
}
/**
 * How a select names its row for screen readers: by its first column when that tells the rows apart (it isn't the
 * column being changed, and no other row has the same), else by its number.
 */
const rowNames = computed(() => {
  const first = columns.value[0]
  const texts = rows.value.map((row) => (first && !first.options ? cellContent(row, first.field, first.filter).text.trim() : ''))
  return texts.map((text, i) => (text && texts.indexOf(text) === texts.lastIndexOf(text) ? `“${text}”` : `row ${i + 1}`))
})
async function changeCell(row: unknown, index: number, field: string, event: Event) {
  const select = event.target as HTMLSelectElement
  const key = `${index}:${field}`
  // One change of a cell at a time: a second while the first is sent is put back.
  if (!updateAction.value || changing.value.has(key)) {
    select.value = chosen(row, field)
    return
  }
  changing.value = new Set(changing.value).add(key)
  changeProblem.value = ''
  try {
    await store.update(updateAction.value, row, { [field]: typed(select.value, getPath(row, field)) })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    changeProblem.value = error instanceof NotSentFromEditor ? message : `Couldn't change the row: ${message}`
  } finally {
    const done = new Set(changing.value)
    done.delete(key)
    changing.value = done
    // What is stored now (the reloaded row; the row as it was when the change failed), whether or not that differs
    // from what the select is bound to, which Vue only writes when it changes.
    select.value = chosen(rows.value[index] ?? row, field)
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

// A scrolling table shows this many rows before it scrolls; its header stays in view. The box is sized from the rows
// as they render (`fit`, see `scrollFit`), and from an estimate of their height (document.css) until they have.
const fit = ref<string | undefined>()
const scrollStyle = computed(() => (props.node.props.scrollRows ? { '--table-rows': String(props.node.props.scrollRows), maxHeight: fit.value } : undefined))

// The scroll box is a named, focusable region only while it really scrolls (not with fewer rows, at phone width, or
// while loading), so keyboard users don't meet tab stops with nothing to scroll.
const wrap = ref<HTMLElement>()
const overflows = ref(false)
function measure() {
  const el = wrap.value
  fit.value = el && props.node.props.scrollRows ? scrollFit(el, props.node.props.scrollRows) : undefined
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
              <select
                v-if="changeable[index] && column.options"
                class="fd-table-select"
                :value="chosen(row, column.field)"
                :aria-label="`${column.label} of ${rowNames[index]}`"
                :aria-busy="changing.has(`${index}:${column.field}`) ? 'true' : undefined"
                @change="changeCell(row, index, column.field, $event)"
              >
                <!-- A value the options no longer hold (or none) still shows, but can't be picked again. -->
                <option v-if="!column.options.includes(chosen(row, column.field))" :value="chosen(row, column.field)" disabled>
                  {{ chosen(row, column.field) || '—' }}
                </option>
                <option v-for="option in column.options" :key="option" :value="option">{{ option }}</option>
              </select>
              <template v-for="(cell, k) in changeable[index] && column.options ? [] : [cellContent(row, column.field, column.filter)]" :key="k">
                <a
                  v-if="cell.href"
                  :href="cell.href"
                  :target="opensNewTab(cell.href) ? '_blank' : undefined"
                  :rel="opensNewTab(cell.href) ? 'noopener noreferrer' : undefined"
                  >{{ cell.text }}</a
                >
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
                <button v-else type="button" class="fd-table-action" :data-delete-row="index" :aria-label="`Delete row ${index + 1}`" @click="ask(row)">
                  Delete
                </button>
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
    <p v-if="changeProblem" class="fd-table-note fd-table-delete-problem" role="alert">{{ changeProblem }}</p>
    <p v-if="!node.props.title && state.status === 'loaded' && rows.length > 0" class="fd-table-foot">{{ count }}</p>
  </section>
</template>
