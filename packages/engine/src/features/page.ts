import type { FeatureDefinition } from '../feature.js'
import { asString, nameInput } from '../inputs.js'
import { node } from '../nodes.js'
import { CONTENT_WIDTH_PRESETS, CONTENT_WIDTH_SCALE, formatWidth, readWidth, widthCss } from '../sizes.js'
import type { ThemeTokens } from '../theme/tokens.js'
import { isThemeExports } from './theme.js'

export const PageFeature: FeatureDefinition = {
  type: 'PageFeature',
  name: 'Page',
  icon: 'file',
  placement: 'required',
  inputs: [
    nameInput('Page'),
    {
      name: 'theme',
      label: 'Theme',
      type: 'reference',
      accepts: ['ThemeFeature'],
      soft: true,
      default: '',
      control: 'theme-select',
    },
    {
      name: 'content_width',
      label: 'Content width (px)',
      type: 'string',
      default: '',
      placeholder: "The theme's",
      hint: "How wide this page's content gets, over its theme's. You can also drag its edge on the page.",
      control: 'pixels',
      pixelScale: CONTENT_WIDTH_SCALE,
      options: [{ value: '', text: "Theme's" }, ...CONTENT_WIDTH_PRESETS.map((p) => ({ value: formatWidth(p.width), text: p.name }))],
      commitOnBlur: true,
    },
    { name: 'background_image', label: 'Background Image', type: 'string', default: '', control: 'text-input' },
  ],

  slots: () => ['content'],

  generate(inputs, ctx) {
    // Colors come from the theme (legacy border_color / background_color inputs are dropped by the migration and
    // ignored if still stored). A background image is content, so it stays.
    const style: Record<string, string> = {}
    const image = asString(inputs.background_image)
    if (image) style.backgroundImage = `url(${JSON.stringify(image)})`

    // No theme, or one that is missing or broken (a soft reference): the default theme applies.
    const themeId = asString(inputs.theme)
    const theme = themeId === '' ? undefined : ctx.resolve(themeId)?.exports
    const props: { theme?: ThemeTokens; contentWidth?: string } = isThemeExports(theme) ? { theme: theme.tokens } : {}
    if (asString(inputs.content_width).trim() !== '') {
      const width = readWidth(inputs.content_width, CONTENT_WIDTH_SCALE)
      if (width === undefined)
        ctx.report('warning', `Content width "${asString(inputs.content_width)}" should be whole pixels such as 960, or full; using the theme's`)
      else props.contentWidth = widthCss(width)
    }
    return { node: node('page', ctx.nodeId(), props, { slot: 'content', style }) }
  },
}
