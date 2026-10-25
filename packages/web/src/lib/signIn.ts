/**
 * Whether an answer from this site's API is Cloudflare Access's rather than the Worker's, because the sign-in expired:
 * a redirect to its sign-in page (with `redirect: 'manual'`, an opaque one; a 304 is no redirect), or one of its pages
 * (sign-in, or a 401 / 403) where the API answers JSON. An HTML 5xx (Cloudflare's own error pages) is a failure, not a
 * sign-in.
 */
export function isSignInAnswer(response: Response): boolean {
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400 && response.status !== 304)) return true
  return response.status < 500 && !!response.headers.get('Content-Type')?.toLowerCase().startsWith('text/html')
}
