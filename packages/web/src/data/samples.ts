import type { AppModel } from '@feature-domain/engine'
import { SAMPLE_MODELS } from './sampleModels'

// The samples, written for this app (`sampleModels/`). The Worker seeds its database with them (packages/worker
// scripts/seed.ts). The legacy samples (app_models/ and sample.json) stay as the engine's migration fixtures.

/** The set of samples the database is seeded with (set 1 was the legacy samples, which browsers were once given). */
export const SAMPLE_SET = 2

/** The samples, copied so callers never share them. */
export function sampleModels(): AppModel[] {
  return SAMPLE_MODELS.map((model) => structuredClone(model) as AppModel)
}
