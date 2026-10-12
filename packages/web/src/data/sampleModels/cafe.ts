import { inCell, inPage, inPanel, root, sample } from './build'

// A small business page: a fictional café on a real town green, with hours, a map, the weather and two calls to action.
export const cafe = sample('Harbor Coffee', (add) => {
  const theme = add('ThemeFeature', {
    name: 'Harbor Coffee',
    accent: '#a0522d',
    band: '#2e1d14',
    scheme: 'light',
    fonts: 'editorial',
    radius: 'soft',
    density: 'comfortable',
    shadow: 'soft',
    well: 'tint',
  })
  const page = add('PageFeature', { name: 'Page', theme }, root())
  add('ImageFeature', { name: 'Banner', source: 'illustration', illustration: 'banner/shapes', banner_height: 'short', width: '', decorative: true }, inPage(page))
  add('HeaderFeature', { name: 'Name', text: 'Harbor Coffee', size: 1, color: 'accent', align: 'left' }, inPage(page))
  add('TextFeature', { name: 'Tagline', text: 'Small-batch coffee and pastries baked every morning, on the Guilford green since 2014.' }, inPage(page))
  add('ButtonFeature', { name: 'Order', text: 'Order ahead', href: 'https://example.com/harbor-coffee/order', style: 'primary', size: 'large', align: 'left' }, inPage(page))

  const about = add('ContainerFeature', { name: 'About', rows: 1, columns: 2, well: false }, inPage(page))
  add(
    'TextWithParagraphFeature',
    {
      name: 'Our coffee',
      title: 'Our coffee',
      text: 'We roast in small batches twice a week, so every bag on the shelf is less than ten days old.\n\nThis month: a washed Ethiopian with notes of bergamot and stone fruit, and our house espresso blend.',
    },
    inCell(about, 1, 1),
  )
  const hours = add('PanelFeature', { name: 'Hours', heading: 'Hours', emphasis: 'quiet' }, inCell(about, 1, 2))
  add('TextFeature', { name: 'Weekdays', text: 'Monday to Friday: 6:30 am – 5 pm' }, inPanel(hours))
  add('TextFeature', { name: 'Saturday', text: 'Saturday: 7 am – 5 pm' }, inPanel(hours))
  add('TextFeature', { name: 'Sunday', text: 'Sunday: 8 am – 3 pm' }, inPanel(hours))

  const visit = add('ContainerFeature', { name: 'Visit', rows: 1, columns: 2, well: true }, inPage(page))
  add('GoogleMapFeature', { name: 'Map', title: 'Visit us', address: '37 Whitfield St, Guilford, CT', height: 'medium' }, inCell(visit, 1, 1))
  add(
    'WeatherFeature',
    { name: 'Weather', title: 'Weather on the green', place: 'Guilford, Connecticut', latitude: '41.2890', longitude: '-72.6818', units: 'fahrenheit', show: 'forecast' },
    inCell(visit, 1, 2),
  )

  add(
    'TextWithParagraphFeature',
    {
      name: 'Catering',
      title: 'Catering and events',
      text: 'Coffee service, pastry trays and boxed lunches for groups of 10 to 200. Give us two days’ notice and we will deliver anywhere in town.',
    },
    inPage(page),
  )
  add('ButtonFeature', { name: 'Catering', text: 'Ask about catering', href: 'https://example.com/harbor-coffee/catering', style: 'secondary', size: 'medium', align: 'left' }, inPage(page))
})
