import type { DocNode } from '@feature-domain/engine'
import { inject, provide, type InjectionKey } from 'vue'

const EDITING: InjectionKey<boolean> = Symbol('editing')

/** Whether the document is on the editor canvas, where text the engine marks (`DocNode.edit`) can be edited in place. */
export function provideEditing(editing: boolean): void {
  provide(EDITING, editing)
}

/**
 * Attributes for an element showing a node's text `prop` (item `item` of a list): on the editor canvas, those the
 * engine marks as a copy of an input say which node and prop they show, so the editor can edit them in place. None
 * elsewhere, so the preview has no editing.
 */
export function useEditAttrs(): (node: DocNode, prop: string, item?: number) => Record<string, string> {
  const editing = inject(EDITING, false)
  return (node, prop, item) => {
    if (!editing || !node.edit?.[prop]) return {}
    const attrs: Record<string, string> = { 'data-edit-node': node.id, 'data-edit': prop }
    if (item !== undefined) attrs['data-edit-item'] = String(item)
    return attrs
  }
}
