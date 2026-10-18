import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { compileTemplate, parse, type SFCTemplateCompileOptions } from 'vue/compiler-sfc'
import { vueCompilerOptions } from '../vueCompilerOptions'

const dir = join(dirname(fileURLToPath(import.meta.url)), '../src/renderer/illustrations')
const drawings = readdirSync(dir).filter((f) => f.endsWith('.vue'))

const compile = (file: string, compilerOptions: SFCTemplateCompileOptions['compilerOptions'] = vueCompilerOptions) => {
  const { descriptor } = parse(readFileSync(join(dir, file), 'utf8'), { filename: file })
  return compileTemplate({ source: descriptor.template!.content, filename: file, id: file, compilerOptions }).code
}

// The Content Security Policy (public/_headers) refuses style attributes in HTML strings, and Vue would compile large
// static templates, such as the illustrations with their `style="fill: var(…)"`, into such strings.
describe('the Vue compiler options', () => {
  it.each(drawings)('keep %s from becoming an HTML string', (file) => {
    expect(compile(file)).not.toContain('createStaticVNode')
  })

  it('are what prevents it', () => {
    expect(drawings.some((file) => compile(file, {}).includes('createStaticVNode'))).toBe(true)
  })
})
