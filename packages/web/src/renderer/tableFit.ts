// A scrolling table shows exactly its Scroll after rows: the scroll box is sized from the rows as they render (rows
// that wrap are taller), not from an estimate. The editor's resize handle snaps to the same row bottoms.

/** The table's loaded rows (not the loading skeleton). */
export const tableRows = (table: Element) => [...table.querySelectorAll<HTMLElement>('tbody:not(.fd-table-skeleton) > tr')]

/** Rows shown as cards (phone width): they never scroll inside the page. */
export const rowsAsCards = (table: Element) => getComputedStyle(table).display === 'block'

/** Each loaded row's bottom, measured from the top of the table (so the header is included). */
export function rowBottoms(table: Element): number[] {
  const top = table.getBoundingClientRect().top
  return tableRows(table).map((row) => row.getBoundingClientRect().bottom - top)
}

/**
 * The scroll box's max-height for `rows` rows: the bottom of the last one shown (plus a horizontal scroll bar, if the
 * box has one), `none` when every loaded row fits, and undefined (document.css's estimate) while no rows are loaded or
 * they are shown as cards.
 */
export function scrollFit(wrap: HTMLElement, rows: number): string | undefined {
  const table = wrap.querySelector('table')
  if (!table || rowsAsCards(table)) return undefined
  const bottoms = rowBottoms(table)
  if (bottoms.length === 0) return undefined
  if (bottoms.length <= rows) return 'none'
  const style = getComputedStyle(wrap)
  const bar = wrap.offsetHeight - wrap.clientHeight - (parseFloat(style.borderTopWidth) || 0) - (parseFloat(style.borderBottomWidth) || 0)
  return `${Math.ceil(bottoms[rows - 1]! + Math.max(0, bar))}px`
}
