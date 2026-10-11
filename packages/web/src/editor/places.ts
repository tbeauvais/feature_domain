// The Weather feature's Find: Open-Meteo's place search (no key; browsers may call it), used only while editing. The
// place's coordinates are stored in the model, so a published page makes no search.

export interface Place {
  /** How the card names it, e.g. "Guilford, Connecticut". */
  name: string
  /** Where it is, to tell places of the same name apart, e.g. "Connecticut, United States". */
  detail: string
  latitude: string
  longitude: string
}

export const MAX_PLACES = 5

export function placeSearchUrl(query: string): string {
  const params = new URLSearchParams({ name: query.trim(), count: String(MAX_PLACES), language: 'en', format: 'json' })
  return `https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** The places in a search response (none when it found nothing); throws when the response isn't a search result. */
export function readPlaces(response: unknown): Place[] {
  if (!isRecord(response)) throw new Error('The response is not a place search result')
  if (response.results === undefined) return []
  if (!Array.isArray(response.results)) throw new Error('The response is not a place search result')
  const places: Place[] = []
  for (const result of response.results) {
    if (!isRecord(result)) continue
    const { latitude, longitude } = result
    const name = text(result.name)
    if (name === '' || typeof latitude !== 'number' || typeof longitude !== 'number') continue
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue
    const region = text(result.admin1)
    const country = text(result.country)
    places.push({
      name: [name, region !== name ? region || country : country].filter(Boolean).join(', '),
      detail: [region, country].filter(Boolean).join(', '),
      latitude: latitude.toFixed(4),
      longitude: longitude.toFixed(4),
    })
  }
  return places.slice(0, MAX_PLACES)
}
