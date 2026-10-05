<script setup lang="ts">
import { ROOT_ID, type DocNode } from '@feature-domain/engine'
import { computed } from 'vue'
import { nodeComponents } from './nodeComponents'

// Renders one document node with the component for its kind, then its children inside that component's slot.
// `owner` is the feature instance that generated the nearest enclosing feature node; slot nodes record it as their
// parent so editing (drop targets, selection) can map DOM back to the model.
const props = defineProps<{ node: DocNode; owner?: string }>()

const childOwner = computed(() => props.node.featureInstanceId ?? props.owner ?? ROOT_ID)
const attrs = computed(() => {
  const a: Record<string, string> = { 'data-node-id': props.node.id }
  if (props.node.featureInstanceId !== undefined) a['data-feature-id'] = props.node.featureInstanceId
  if (props.node.slot !== undefined) {
    a['data-slot'] = props.node.slot
    a['data-slot-parent'] = props.node.featureInstanceId ?? props.owner ?? ROOT_ID
  }
  return a
})
</script>

<template>
  <component :is="nodeComponents[node.kind]" :node="node" v-bind="attrs">
    <NodeView v-for="child in node.children" :key="child.id" :node="child" :owner="childOwner" />
  </component>
</template>
