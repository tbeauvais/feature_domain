<script setup lang="ts">
import { ref } from 'vue'

// Keyboard shortcuts reference. A native <dialog>: modal, closes with Escape, and returns focus by itself.
const dialog = ref<HTMLDialogElement | null>(null)
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const mod = isMac ? '⌘' : 'Ctrl+'

const shortcuts = [
  { keys: `${mod}Z`, does: 'Undo' },
  { keys: isMac ? '⇧⌘Z' : 'Ctrl+Y', does: 'Redo' },
  { keys: '?', does: 'Show these shortcuts' },
  { keys: 'Esc', does: 'Close this dialog' },
]
const tips = [
  'Drag features from the palette, the page or the tree to place or move them.',
  'Click a feature on the page or in the tree to edit it in the inspector.',
  'Move up, Move down and Location in the inspector move a feature without dragging.',
]

defineExpose({ open: () => dialog.value?.showModal() })
</script>

<template>
  <dialog
    ref="dialog"
    class="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-slate-200 p-0 text-slate-900 shadow-xl backdrop:bg-slate-900/30"
    aria-labelledby="shortcuts-heading"
    data-testid="shortcuts-dialog"
  >
    <div class="space-y-4 p-5">
      <h2 id="shortcuts-heading" class="text-base font-semibold">Keyboard shortcuts</h2>
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <template v-for="s in shortcuts" :key="s.keys">
          <dt><kbd class="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-xs">{{ s.keys }}</kbd></dt>
          <dd>{{ s.does }}</dd>
        </template>
      </dl>
      <ul class="list-disc space-y-1 pl-5 text-sm text-slate-600">
        <li v-for="tip in tips" :key="tip">{{ tip }}</li>
      </ul>
      <form method="dialog" class="flex justify-end">
        <button type="submit" class="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">Close</button>
      </form>
    </div>
  </dialog>
</template>
