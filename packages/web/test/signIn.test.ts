import { describe, expect, it } from 'vitest'
import { isSignInAnswer } from '../src/lib/signIn'

const html = (status: number) => new Response(status === 304 ? null : '<html>', { status, headers: { 'Content-Type': 'text/html' } })

describe('isSignInAnswer', () => {
  it("takes Access's redirects and pages for an expired sign-in", () => {
    expect(isSignInAnswer(new Response(null, { status: 302, headers: { Location: 'https://team.cloudflareaccess.com/' } }))).toBe(true)
    expect(isSignInAnswer(html(200))).toBe(true)
    expect(isSignInAnswer(html(403))).toBe(true)
  })

  it("leaves the Worker's answers, a 304 and Cloudflare's error pages alone", () => {
    expect(isSignInAnswer(Response.json([]))).toBe(false)
    expect(isSignInAnswer(Response.json({ error: 'Not found' }, { status: 404 }))).toBe(false)
    expect(isSignInAnswer(new Response(null, { status: 304 }))).toBe(false)
    expect(isSignInAnswer(html(502))).toBe(false)
  })
})
