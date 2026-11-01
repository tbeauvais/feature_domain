import { inCell, inPage, inPanel, root, sample } from './build'

// A rowing club's members-only boat bookings: the published app asks visitors to sign in with an emailed code (the
// Sign-in feature), the Account shows who is signed in, and bookings are kept in a Database table, made with a form and
// listed in a table.
const bookings = [
  { boat: 'Heron', date: '2026-11-07', session: 'early', rower: 'Maya Chen', crew: 1, notes: 'Steady state, out to the old pier and back.' },
  { boat: 'Osprey', date: '2026-11-07', session: 'morning', rower: 'Jonas Weber', crew: 4, notes: 'Novice four, with a coach launch.' },
  { boat: 'Curlew', date: '2026-11-08', session: 'early', rower: 'Aisha Bello', crew: 2 },
  { boat: 'Tern', date: '2026-11-10', session: 'evening', rower: 'Rob Ellison', crew: 1, notes: 'Back before sunset.' },
]

export const rowingClub = sample('Saltmarsh Rowing Club', (add) => {
  const theme = add('ThemeFeature', {
    name: 'Saltmarsh',
    accent: '#1d6fa3',
    band: '#14324a',
    scheme: 'light',
    fonts: 'modern',
    radius: 'round',
    density: 'comfortable',
    shadow: 'soft',
    well: 'tint',
  })
  // Only people signed in open the published app; anyone may make an account (choose Listed people for a real club).
  add('SignInFeature', { name: 'Sign-in', open_to: 'signed-in', sign_up: true })
  const table = add('DatabaseTableFeature', {
    name: 'Bookings',
    fields: [
      'boat: choice Heron | Curlew | Tern | Osprey, required',
      'date: date, required',
      'session: choice early | morning | evening, required, default early',
      'rower: text, required',
      'crew: number',
      'notes: long text',
    ],
    sample_rows: JSON.stringify(bookings, null, 2),
  })
  const page = add('PageFeature', { name: 'Page', theme }, root())
  add('AccountFeature', { name: 'Account', sign_in_text: 'Member sign-in' }, inPage(page))
  add('HeaderFeature', { name: 'Title', text: 'Saltmarsh Rowing Club boat bookings', size: 1, align: 'left', color: 'accent' }, inPage(page))
  add(
    'TextFeature',
    {
      name: 'Intro',
      text: 'Book a club boat for your outing. The boathouse opens at 6 am, and every boat is back on its rack by sunset.',
    },
    inPage(page),
  )
  const top = add('ContainerFeature', { name: 'Book and rules', rows: 1, columns: 2, column_widths: '3, 2', well: false }, inPage(page))
  add(
    'FormFeature',
    {
      name: 'Book a boat',
      title: 'Book a boat',
      data_resource: table,
      fields: ['boat', 'date', 'session', 'rower', 'crew', 'notes'],
      labels: ['Boat', 'Day', 'Session', 'Your name', 'Crew', 'Notes'],
      submit_label: 'Book it',
      success_message: 'Booked. Your outing is in the list below.',
    },
    inCell(top, 1, 1),
  )
  const rules = add('PanelFeature', { name: 'Before you go out', heading: 'Before you go out', emphasis: 'quiet' }, inCell(top, 1, 2))
  add('TextFeature', { name: 'Count', text: '{{length}} outings booked.', data_resource: table }, inPanel(rules))
  add(
    'ListFeature',
    {
      name: 'Rules',
      items: ['Sign the logbook in the boathouse.', 'Wear a lifejacket in singles from November to March.', 'Can’t make it? Delete your booking.'],
    },
    inPanel(rules),
  )
  add(
    'TableFeature',
    {
      name: 'Bookings',
      title: 'Bookings',
      data_resource: table,
      delete_operation: 'DELETE rows',
      fields: ['date', 'session', 'boat', 'rower', 'crew', 'notes'],
      labels: ['Day', 'Session', 'Boat', 'Rower', 'Crew', 'Notes'],
      filters: ['date', '', 'badge', '', '', ''],
      scroll_rows: 10,
    },
    inPage(page),
  )
})
