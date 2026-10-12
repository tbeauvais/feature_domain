import { inCell, inPage, inPanel, root, sample } from './build'

// A short tour of the app, written for it: what features and inputs are, and what to try first.
export const guide = sample('Start here', (add) => {
  const page = add('PageFeature', { name: 'Page' }, root())
  add('ImageFeature', { name: 'Banner', source: 'illustration', illustration: 'banner/shapes', banner_height: 'short', width: '', decorative: true }, inPage(page))
  add('HeaderFeature', { name: 'Title', text: 'Build a page from features', size: 1, align: 'left' }, inPage(page))
  add('TextFeature', { name: 'Lead', text: 'Every part of this page is a feature: a header, a text, a card, a table. Each one has inputs, and the page is generated from them.' }, inPage(page))
  const grid = add('ContainerFeature', { name: 'Ideas', rows: 1, columns: 2, well: false }, inPage(page))
  add(
    'TextWithParagraphFeature',
    {
      name: 'Features',
      title: 'Features are parameters',
      text: 'Select anything on the page, or a row in the feature tree, and its inputs open in the inspector on the right.\n\nChange an input and the page regenerates at once. Undo takes you back a step.',
    },
    inCell(grid, 1, 1),
  )
  add(
    'TextWithParagraphFeature',
    {
      name: 'Data and themes',
      title: 'Data and themes are features too',
      text: 'A data resource reads an address or serves sample rows; tables, charts, forms and texts read from it.\n\nA theme sets colors, type and spacing for every page that uses it.',
    },
    inCell(grid, 1, 2),
  )
  const tryIt = add('PanelFeature', { name: 'Try it', heading: 'Try it now', emphasis: 'highlight' }, inPage(page))
  add('TextFeature', { name: 'Step 1', text: '1. Click this text and change it in the inspector.' }, inPanel(tryIt))
  add('TextFeature', { name: 'Step 2', text: '2. Drag a Weather feature from the palette onto the page.' }, inPanel(tryIt))
  add('TextFeature', { name: 'Step 3', text: '3. Open Preview to see the page as a visitor would.' }, inPanel(tryIt))
  add('SeparatorFeature', { name: 'Divider', style: 'wave', width: 40 }, inPage(page))
  add('TextFeature', { name: 'Samples', text: 'The other samples show what a few features add up to: a café, a pricing page, a sales dashboard, a portfolio and a meetup.' }, inPage(page))
  add('ButtonFeature', { name: 'Source', text: 'See the source on GitHub', href: 'https://github.com/tbeauvais/feature_domain', style: 'secondary', size: 'medium', align: 'left' }, inPage(page))
})
