import { inCell, inPage, inPanel, root, sample } from './build'

// A local meetup's event page: the schedule and speakers from sample data, a signup form, and a live count of signups.
const schedule = [
  { time: '6:00 pm', session: 'Doors open: pizza, drinks and introductions', speaker: '' },
  { time: '6:30 pm', session: 'Signals in practice: state without the ceremony', speaker: 'Priya Raman' },
  { time: '7:05 pm', session: 'Testing what users see with Playwright', speaker: 'Marcus Ortiz' },
  { time: '7:40 pm', session: 'Lightning talks (sign up at the door)', speaker: '' },
  { time: '8:15 pm', session: 'Wrap-up and next month’s topics', speaker: 'Dana Whitfield' },
]
const attendees = [
  { name: 'Leah Kim', email: 'leah@example.com', company: 'Shoreline Labs' },
  { name: 'Omar Haddad', email: 'omar@example.com', company: 'Freelance' },
  { name: 'Grace Liu', email: 'grace@example.com', company: 'Elm City Health' },
  { name: 'Ben Carter', email: 'ben@example.com', company: 'Harbor Robotics' },
]
const speakers = [
  {
    name: 'Priya Raman',
    text: 'Front-end lead at a New Haven fintech. Has rewritten the same dashboard in four frameworks and has opinions about all of them.',
  },
  { name: 'Marcus Ortiz', text: 'QA engineer turned developer. Runs the end-to-end test suite for a hospital scheduling app.' },
  { name: 'Dana Whitfield', text: 'Organizer of the meetup since 2019, and the person to ask about speaking next month.' },
]

export const meetup = sample('Shoreline JS meetup', (add) => {
  const theme = add('ThemeFeature', {
    name: 'Shoreline JS',
    accent: '#0f766e',
    band: '#123b38',
    scheme: 'light',
    fonts: 'modern',
    radius: 'round',
    density: 'comfortable',
    shadow: 'soft',
    well: 'band',
  })
  const sessions = add('DataResourceFeature', { name: 'Schedule', source: 'sample', sample_rows: JSON.stringify(schedule, null, 2) })
  const signups = add('DataResourceFeature', { name: 'Signups', source: 'sample', sample_rows: JSON.stringify(attendees, null, 2) })
  const page = add('PageFeature', { name: 'Page', theme }, root())
  add('HeaderFeature', { name: 'Title', text: 'Shoreline JavaScript Meetup', size: 1, align: 'left', color: 'accent' }, inPage(page))
  add('TextFeature', { name: 'When', text: 'Thursday, November 19 · 6:00 – 8:30 pm · Elm City Workspace, New Haven. Free, with pizza.' }, inPage(page))
  add(
    'TableFeature',
    {
      name: 'Schedule',
      title: 'Schedule',
      data_resource: sessions,
      fields: ['time', 'session', 'speaker'],
      labels: ['Time', 'Session', 'Speaker'],
      scroll_rows: 0,
    },
    inPage(page),
  )
  add('HeaderFeature', { name: 'Speakers', text: 'Speakers', size: 2, align: 'left' }, inPage(page))
  const grid = add('ContainerFeature', { name: 'Speakers', rows: 1, columns: 3, well: false }, inPage(page))
  speakers.forEach((speaker, i) => add('TextWithParagraphFeature', { name: speaker.name, title: speaker.name, text: speaker.text }, inCell(grid, 1, i + 1)))
  const signup = add('ContainerFeature', { name: 'Signup', rows: 1, columns: 2, well: true }, inPage(page))
  add(
    'FormFeature',
    {
      name: 'Signup form',
      title: 'Save your seat',
      data_resource: signups,
      fields: ['name', 'email', 'company'],
      labels: ['Name', 'Email', 'Company (optional)'],
      required_fields: ['name', 'email'],
      submit_label: 'Save my seat',
      success_message: 'You’re on the list. See you on the 19th!',
    },
    inCell(signup, 1, 1),
  )
  const going = add('PanelFeature', { name: 'Going', heading: 'Who’s coming', emphasis: 'normal' }, inCell(signup, 1, 2))
  add('TextFeature', { name: 'Count', text: '{{length}} people have signed up so far. The room holds 60.', data_resource: signups }, inPanel(going))
  add('GoogleMapFeature', { name: 'Venue', title: 'Elm City Workspace', address: '200 Orange St, New Haven, CT', height: 'short' }, inPanel(going))
})
