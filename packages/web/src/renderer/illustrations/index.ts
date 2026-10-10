import type { IllustrationId } from '@feature-domain/engine'
import type { Component } from 'vue'
import BannerBlueprint from './BannerBlueprint.vue'
import BannerDataDots from './BannerDataDots.vue'
import BannerShapes from './BannerShapes.vue'
import DividerDots from './DividerDots.vue'
import DividerRuler from './DividerRuler.vue'
import DividerWave from './DividerWave.vue'
import SpotData from './SpotData.vue'
import SpotEmpty from './SpotEmpty.vue'
import SpotMap from './SpotMap.vue'

/**
 * The drawing for each built-in illustration. Our own SVG, rendered inline: every colour is a theme token (`var(--fd-*)`)
 * or the current colour, so illustrations follow the theme. Typed as a full record, so adding one to the engine's
 * catalogue fails the typecheck here until it is drawn. Tests check that none contains scripts, event handlers or
 * references to other documents.
 */
export const illustrationComponents: Record<IllustrationId, Component> = {
  'banner/blueprint': BannerBlueprint,
  'banner/shapes': BannerShapes,
  'banner/data-dots': BannerDataDots,
  'spot/data': SpotData,
  'spot/map': SpotMap,
  'spot/empty': SpotEmpty,
  'divider/wave': DividerWave,
  'divider/dots': DividerDots,
  'divider/ruler': DividerRuler,
}
