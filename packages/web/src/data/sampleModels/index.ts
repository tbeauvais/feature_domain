import type { AppModel } from '@feature-domain/engine'
import { cafe } from './cafe'
import { guide } from './guide'
import { meetup } from './meetup'
import { portfolio } from './portfolio'
import { pricing } from './pricing'
import { sales } from './sales'

/** The sample models written for this app, in the order the model list shows them. */
export const SAMPLE_MODELS: readonly AppModel[] = [guide, cafe, pricing, sales, portfolio, meetup]
