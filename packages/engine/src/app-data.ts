// What the Worker needs to keep a model's rows: its Database tables, by key, with their fields and sample rows.

import { isDatabaseTableExports, type DatabaseTableExports } from './features/database-table.js'
import { defaultRegistry } from './features/index.js'
import type { FeatureRegistry } from './feature.js'
import { generate } from './generate.js'
import { isTableKey } from './links.js'
import type { AppModel } from './types.js'

export type DatabaseTable = DatabaseTableExports['table']

/**
 * The model's Database tables that generate, by key (the instance id): what the rows API serves. A table that doesn't
 * generate (an unknown type, or a key that can't be part of an address) has no rows to read or write.
 */
export function databaseTables(model: AppModel, registry: FeatureRegistry = defaultRegistry): Map<string, DatabaseTable> {
  const result = generate(model, registry)
  const tables = new Map<string, DatabaseTable>()
  for (const instance of model.features) {
    if (instance.feature !== 'DatabaseTableFeature') continue
    const exports = result.exports.get(instance.id)
    if (isDatabaseTableExports(exports) && isTableKey(exports.table.key)) tables.set(exports.table.key, exports.table)
  }
  return tables
}

/**
 * The keys of every Database table the model holds, whether it generates or not: a table with a problem keeps its rows,
 * only one removed from the model loses them (`RowStore.keepTables`).
 */
export function databaseTableKeys(model: AppModel): string[] {
  return model.features.filter((f) => f.feature === 'DatabaseTableFeature').map((f) => f.id)
}
