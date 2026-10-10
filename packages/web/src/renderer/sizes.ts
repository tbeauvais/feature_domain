/** Legacy sizes were HTML attributes ("300", "100%"); as CSS a bare number means pixels. Empty means unset. */
export function cssSize(value: string): string | undefined {
  if (value.trim() === '') return undefined
  return /^\d+(\.\d+)?$/.test(value.trim()) ? `${value.trim()}px` : value.trim()
}
