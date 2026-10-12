import { inCell, inPage, root, sample } from './build'

// A software pricing page (it replaces the legacy Buy Deal sample): three plans side by side, a FAQ and a sales contact.
const plans = [
  { name: 'Starter', description: 'For freelancers keeping their own books.', items: ['1 user', 'Invoices and receipts', 'Bank sync for 2 accounts'], price: '$12 / month' },
  { name: 'Team', description: 'For small teams that share the work.', items: ['Up to 5 users', 'Everything in Starter', 'Payroll for 10 people', 'Priority email support'], price: '$29 / month' },
  { name: 'Business', description: 'For growing companies with an accountant.', items: ['Unlimited users', 'Everything in Team', 'Multi-currency', 'Phone support'], price: '$79 / month' },
]

const faq = [
  { title: 'Can I change plans later?', text: 'Yes. Upgrade or downgrade at any time; we prorate the difference on your next invoice.' },
  { title: 'What happens after the trial?', text: 'Your books stay exactly as you left them. Pick a plan to keep working, or export everything as CSV.' },
  { title: 'Do you offer discounts?', text: 'Nonprofits and schools get 30% off any plan. Paying yearly saves two months.' },
]

export const pricing = sample('Ledgerly pricing', (add) => {
  const theme = add('ThemeFeature', {
    name: 'Ledgerly',
    accent: '#4f46e5',
    band: '#1e1b4b',
    scheme: 'light',
    fonts: 'modern',
    radius: 'soft',
    density: 'comfortable',
    shadow: 'lifted',
    well: 'tint',
  })
  const page = add('PageFeature', { name: 'Page', theme }, root())
  add('HeaderFeature', { name: 'Title', text: 'Simple pricing for growing teams', size: 1, align: 'left' }, inPage(page))
  add('TextFeature', { name: 'Lead', text: 'Every plan starts with a free 14-day trial. No credit card needed.' }, inPage(page))
  const grid = add('ContainerFeature', { name: 'Plans', rows: 1, columns: 3, well: true }, inPage(page))
  plans.forEach((plan, i) => {
    add('ListGroupFeature', { name: plan.name, heading: plan.name, description: plan.description, items: plan.items, highlight: plan.price }, inCell(grid, 1, i + 1))
    add('ButtonFeature', { name: `${plan.name} trial`, text: `Try ${plan.name}`, href: `https://example.com/ledgerly/signup?plan=${plan.name.toLowerCase()}`, style: i === 1 ? 'primary' : 'secondary', size: 'medium', align: 'center' }, inCell(grid, 1, i + 1))
  })
  add('HeaderFeature', { name: 'FAQ', text: 'Questions, answered', size: 2, align: 'left' }, inPage(page))
  for (const item of faq) add('TextWithParagraphFeature', { name: item.title, title: item.title, text: item.text }, inPage(page))
  add('ButtonFeature', { name: 'Sales', text: 'Talk to sales', href: 'https://example.com/ledgerly/contact', style: 'soft', size: 'medium', align: 'left' }, inPage(page))
})
