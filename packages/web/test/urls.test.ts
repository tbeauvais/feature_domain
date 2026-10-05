import { afterEach, describe, expect, it, vi } from 'vitest'
import { browserFetchJson } from '../src/renderer/rows'
import { isHttpUrl, safeHref, safeImageSrc } from '../src/renderer/urls'

describe('URL policies', () => {
  it('allows only http(s) links', () => {
    expect(['https://a.b/c', 'HTTP://a', ' https://x ', '', '/rel', 'javascript:alert(1)', 'data:text/html,x', 'mailto:a@b'].map(isHttpUrl)).toEqual([
      true, true, true, false, false, false, false, false,
    ])
    expect(safeHref(' https://x ')).toBe('https://x')
    expect(safeHref('javascript:alert(1)')).toBeUndefined()
  })

  it('allows http(s), relative and data:image sources for images', () => {
    expect(safeImageSrc('https://a/b.png')).toBe('https://a/b.png')
    expect(safeImageSrc('images/b.png')).toBe('images/b.png')
    expect(safeImageSrc('/b.png')).toBe('/b.png')
    expect(safeImageSrc('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
    for (const bad of ['', '  ', 'javascript:alert(1)', 'JaVaScRiPt:x', 'data:text/html,<script>', 'vbscript:x', 'file:///etc/passwd']) {
      expect(safeImageSrc(bad), bad).toBeUndefined()
    }
  })
})

describe('browserFetchJson', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('refuses non-http(s) URLs without fetching', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(browserFetchJson('')).rejects.toThrow('Only http(s) URLs can be loaded, not ""')
    await expect(browserFetchJson('/index.html')).rejects.toThrow('Only http(s) URLs')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns JSON from http(s) URLs and reports HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.endsWith('ok') ? new Response('[1]') : new Response('', { status: 503, statusText: 'Unavailable' }))))
    expect(await browserFetchJson('https://api/ok')).toEqual([1])
    await expect(browserFetchJson('https://api/down')).rejects.toThrow('503 Unavailable')
  })
})
