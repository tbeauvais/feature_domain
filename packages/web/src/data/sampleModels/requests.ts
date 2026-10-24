import { inCell, inPage, inPanel, root, sample } from './build'

// A small team's request tracker: requests kept in a Database table (the app's own rows, in D1), filed with a form,
// listed in a table with their priority and a status changed in place, and counted.
const requests = [
  {
    title: 'Replace the dead monitor at desk 14',
    details: 'Left screen stays black since Monday. Spare monitors are in the storage room.',
    requested_by: 'Ines Duarte',
    priority: 'urgent',
    status: 'in progress',
    due: '2026-10-27',
  },
  {
    title: 'Book the large meeting room for the quarterly review',
    details: 'Thursday, November 12, 2 to 5 pm, with the projector and coffee for 14.',
    requested_by: 'Sam Okafor',
    priority: 'normal',
    status: 'open',
    due: '2026-11-05',
  },
  {
    title: 'Order standing desk mats',
    details: 'Three mats for the design corner. Any brand under $60 each.',
    requested_by: 'Mia Lindqvist',
    priority: 'low',
    status: 'open',
  },
  {
    title: 'Set up a laptop for the new hire',
    details: 'Starts November 2: the usual developer setup, plus a VPN account.',
    requested_by: 'Ines Duarte',
    priority: 'normal',
    status: 'open',
    due: '2026-10-30',
  },
  {
    title: 'Fix the kitchen dishwasher',
    details: 'Stops halfway through every cycle. The repair company has the model number.',
    requested_by: 'Theo Brandt',
    priority: 'normal',
    status: 'done',
  },
]

export const requestTracker = sample('Team requests', (add) => {
  const theme = add('ThemeFeature', {
    name: 'Fernhill Studio',
    accent: '#3f5bd8',
    band: '#1f2a4d',
    scheme: 'light',
    fonts: 'modern',
    radius: 'round',
    density: 'compact',
    shadow: 'soft',
    well: 'tint',
  })
  const table = add('DatabaseTableFeature', {
    name: 'Requests',
    fields: [
      'title: text, required',
      'details: long text',
      'requested_by: text, required',
      'priority: choice low | normal | urgent, default normal',
      'status: choice open | in progress | done, required, default open',
      'due: date',
    ],
    sample_rows: JSON.stringify(requests, null, 2),
  })
  const page = add('PageFeature', { name: 'Page', theme }, root())
  add('HeaderFeature', { name: 'Title', text: 'Fernhill Studio requests', size: 1, align: 'left', color: 'accent' }, inPage(page))
  add(
    'TextFeature',
    {
      name: 'Intro',
      text: 'Ask the operations team for anything the studio needs: equipment, rooms, repairs or supplies. We look at new requests every morning and reply in the request.',
    },
    inPage(page),
  )
  const top = add('ContainerFeature', { name: 'File and count', rows: 1, columns: 2, column_widths: '3, 2', well: false }, inPage(page))
  add(
    'FormFeature',
    {
      name: 'New request',
      title: 'New request',
      data_resource: table,
      fields: ['title', 'details', 'requested_by', 'priority', 'due'],
      labels: ['What do you need?', 'Details', 'Your name', 'Priority', 'Needed by'],
      submit_label: 'Send request',
      success_message: 'Request sent. It’s in the list below.',
    },
    inCell(top, 1, 1),
  )
  const queue = add('PanelFeature', { name: 'Queue', heading: 'The queue', emphasis: 'quiet' }, inCell(top, 1, 2))
  add('TextFeature', { name: 'Count', text: '{{length}} requests so far, newest at the bottom.', data_resource: table }, inPanel(queue))
  add('TextFeature', { name: 'Urgent', text: 'Something broken that stops your work? Mark it urgent and we’ll start on it the same day.' }, inPanel(queue))
  add(
    'TableFeature',
    {
      name: 'Requests',
      title: 'Requests',
      data_resource: table,
      delete_operation: 'DELETE rows',
      // Each request's status is a select: the operations team moves it along as they work.
      update_operation: 'PATCH rows',
      change_fields: ['status'],
      fields: ['title', 'requested_by', 'priority', 'status', 'due', 'created_at'],
      labels: ['Request', 'From', 'Priority', 'Status', 'Needed by', 'Asked'],
      filters: ['', '', 'badge', '', 'date', 'date'],
      scroll_rows: 10,
    },
    inPage(page),
  )
})
