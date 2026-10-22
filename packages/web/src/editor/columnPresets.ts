import { asInt, clamp, formatColumnWidths, MAX_COLUMNS, parseColumnWidths, reduceShares, type InputValue } from '@feature-domain/engine'

/** Common column layouts, offered beside a Container's Column widths (the field stays for any other shares). */
const PRESETS: Record<number, number[][]> = {
  2: [
    [2, 1],
    [1, 2],
    [3, 1],
    [1, 3],
  ],
  3: [
    [1, 2, 1],
    [2, 1, 1],
    [1, 1, 2],
  ],
  4: [[1, 2, 2, 1]],
}

/** The presets for a container with `columns` columns (`columns` as stored; absent means the default, 2). */
export function columnPresets(columns: InputValue | undefined): { text: string; value: string }[] {
  const n = clamp(asInt(columns, 2), 1, MAX_COLUMNS)
  if (n < 2) return []
  return [{ text: 'Equal', value: '' }, ...(PRESETS[n] ?? []).map((shares) => ({ text: shares.join(' : '), value: formatColumnWidths(shares) }))]
}

/** Column widths as one canonical value ("4,2" and "2, 1" are the same layout), or undefined when invalid. */
export function canonicalWidths(value: InputValue | undefined, columns: InputValue | undefined): string | undefined {
  const parsed = parseColumnWidths(value, clamp(asInt(columns, 2), 1, MAX_COLUMNS))
  if (parsed === 'invalid') return undefined
  return parsed === undefined ? '' : formatColumnWidths(reduceShares(parsed))
}
