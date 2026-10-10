import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(resolve(here, path), 'utf8')

describe('CI', () => {
  it('runs end-to-end tests in the Playwright image matching @playwright/test, so screenshots match their baselines', () => {
    const version = JSON.parse(read('../package.json')).devDependencies['@playwright/test']
    // Pinned exactly: a range could install a different browser than the image's.
    expect(version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(read('../../../.github/workflows/ci.yml')).toContain(`image: mcr.microsoft.com/playwright:v${version}-noble`)
  })
})
