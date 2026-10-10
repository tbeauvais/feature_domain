/**
 * Per-browser editor preferences (canvas width, palette folded). A convenience only: storage may be unavailable or
 * hold anything, so reads fall back and writes may silently fail.
 */
export function loadPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const stored = localStorage.getItem(`feature-domain:${key}`)
    return stored !== null && (allowed as readonly string[]).includes(stored) ? (stored as T) : fallback
  } catch {
    return fallback
  }
}

export function savePref(key: string, value: string): void {
  try {
    localStorage.setItem(`feature-domain:${key}`, value)
  } catch {
    // Not remembered; nothing else depends on it.
  }
}
