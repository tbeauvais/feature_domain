import type { NodeKind } from '@feature-domain/engine'
import type { Component } from 'vue'
import ButtonNode from './nodes/ButtonNode.vue'
import CardNode from './nodes/CardNode.vue'
import GridCellNode from './nodes/GridCellNode.vue'
import GridNode from './nodes/GridNode.vue'
import HeadingNode from './nodes/HeadingNode.vue'
import IllustrationNode from './nodes/IllustrationNode.vue'
import ImageNode from './nodes/ImageNode.vue'
import LinkNode from './nodes/LinkNode.vue'
import ListNode from './nodes/ListNode.vue'
import MediaNode from './nodes/MediaNode.vue'
import PageNode from './nodes/PageNode.vue'
import ParagraphNode from './nodes/ParagraphNode.vue'
import PanelBodyNode from './nodes/PanelBodyNode.vue'
import PanelNode from './nodes/PanelNode.vue'
import PlaceholderNode from './nodes/PlaceholderNode.vue'
import RootNode from './nodes/RootNode.vue'
import SeparatorNode from './nodes/SeparatorNode.vue'
import StackNode from './nodes/StackNode.vue'
import TableNode from './nodes/TableNode.vue'
import TextNode from './nodes/TextNode.vue'

/** One component per node kind. Typed as a full record, so adding a kind to NodeKinds fails the typecheck here. */
export const nodeComponents: Record<NodeKind, Component> = {
  root: RootNode,
  page: PageNode,
  text: TextNode,
  heading: HeadingNode,
  image: ImageNode,
  illustration: IllustrationNode,
  grid: GridNode,
  'grid-cell': GridCellNode,
  panel: PanelNode,
  'panel-body': PanelBodyNode,
  table: TableNode,
  list: ListNode,
  separator: SeparatorNode,
  link: LinkNode,
  button: ButtonNode,
  paragraph: ParagraphNode,
  stack: StackNode,
  media: MediaNode,
  card: CardNode,
  placeholder: PlaceholderNode,
}
