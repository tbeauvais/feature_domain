<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'
import { computed } from 'vue'
import { cellContent } from '../filters'
import { useTableRows } from '../rows'

const props = defineProps<{ node: DocNodeOf<'table'> }>()

const state = useTableRows(computed(() => props.node.props.source))
const rows = computed(() => (state.value.status === 'loaded' ? state.value.rows : []))
</script>

<template>
  <div class="fd-table-wrap">
    <table class="fd-table">
      <thead>
        <tr>
          <th v-for="column in node.props.columns" :key="column.field">{{ column.label }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, index) in rows" :key="index">
          <td v-for="column in node.props.columns" :key="column.field">
            <template v-for="cell in [cellContent(row, column.field, column.filter)]" :key="column.field">
              <a v-if="cell.href" :href="cell.href" target="_blank" rel="noopener noreferrer">{{ cell.text }}</a>
              <template v-else>{{ cell.text }}</template>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="!node.props.source" class="fd-table-note">No data source</p>
    <p v-else-if="state.status === 'loading'" class="fd-table-note">Loading…</p>
    <p v-else-if="state.status === 'error'" class="fd-table-note fd-table-error">Could not load data: {{ state.message }}</p>
    <p v-else-if="state.status === 'loaded' && rows.length === 0" class="fd-table-note">No rows</p>
  </div>
</template>
