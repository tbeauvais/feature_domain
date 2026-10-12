import { inPage, root, sample } from './build'

// A developer's portfolio (it replaces the legacy Data Sample): live from the GitHub API, a profile line and the most
// recently updated repositories, then a featured project.
export const portfolio = sample('Tom Beauvais · projects', (add) => {
  const theme = add('ThemeFeature', {
    name: 'Portfolio',
    accent: '#0e7490',
    band: '#0b2530',
    scheme: 'light',
    fonts: 'modern',
    radius: 'small',
    density: 'comfortable',
    shadow: 'none',
    table: 'hairline',
    well: 'band',
  })
  const profile = add('DataResourceFeature', { name: 'GitHub profile', source: 'address', resource: 'https://api.github.com/users/tbeauvais', operation: 'GET' })
  const repos = add('DataResourceFeature', { name: 'GitHub repos', source: 'address', resource: 'https://api.github.com/users/tbeauvais/repos?sort=updated&per_page=8', operation: 'GET' })
  const page = add('PageFeature', { name: 'Page', theme }, root())
  add('ImageFeature', { name: 'Banner', source: 'illustration', illustration: 'banner/blueprint', banner_height: 'short', width: '', decorative: true }, inPage(page))
  add('HeaderFeature', { name: 'Name', text: 'Tom Beauvais', size: 1, align: 'left' }, inPage(page))
  add('TextFeature', { name: 'Profile', text: '{{public_repos}} public repositories · {{followers}} followers · on GitHub since {{created_at | date}}', data_resource: profile }, inPage(page))
  add('LinkFeature', { name: 'GitHub', text: 'github.com/tbeauvais', href: 'https://github.com/tbeauvais' }, inPage(page))
  add(
    'TableFeature',
    {
      name: 'Repositories',
      title: 'Recently updated',
      data_resource: repos,
      fields: ['name', 'description', 'language', 'updated_at'],
      labels: ['Repository', 'Description', 'Language', 'Updated'],
      filters: ['dataLink :html_url', '', 'badge', 'date'],
      scroll_rows: 10,
    },
    inPage(page),
  )
  add(
    'TextWithParagraphFeature',
    {
      name: 'Featured',
      title: 'Featured: Feature Domain',
      text: 'A feature-based application generator. A page is a list of features with inputs, like the steps of a CAD model, and the engine regenerates the page whenever an input changes.\n\nThis page is one of its samples: the line under my name and the table above read the GitHub API live.',
    },
    inPage(page),
  )
  add('ButtonFeature', { name: 'Repository', text: 'View on GitHub', href: 'https://github.com/tbeauvais/feature_domain', style: 'primary', size: 'medium', align: 'left' }, inPage(page))
})
