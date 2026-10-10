/** Shortcut labels for this platform (⌘ on Apple devices, Ctrl elsewhere). */
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export const UNDO_KEYS = isMac ? '⌘Z' : 'Ctrl+Z'
export const REDO_KEYS = isMac ? '⇧⌘Z' : 'Ctrl+Y'
