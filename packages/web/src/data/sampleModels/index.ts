import type { AppModel } from '@feature-domain/engine'
import { cafe } from './cafe'
import { guide } from './guide'
import { meetup } from './meetup'
import { portfolio } from './portfolio'
import { pricing } from './pricing'
import { requestTracker } from './requests'
import { sales } from './sales'

/**
 * The sample models written for this app, in the order the model list shows them. Add new ones at the end only: the
 * seed stores each under its position (`sample-2-<n>`), and remembers samples added after the first six by that id
 * (packages/worker/scripts/seedSql.ts), so moving one would make a database forget or repeat it.
 */
export const SAMPLE_MODELS: readonly AppModel[] = [guide, cafe, pricing, sales, portfolio, meetup, requestTracker]
