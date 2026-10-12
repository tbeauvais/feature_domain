import { generate, MemoryModelStore, openMeteoUrl, type AppModel } from '@feature-domain/engine'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Inspector from '../src/editor/Inspector.vue'
import PlaceSearchField from '../src/editor/PlaceSearchField.vue'
import { placeSearchUrl, readPlaces } from '../src/editor/places'
import DocumentView from '../src/renderer/DocumentView.vue'
import { FETCH_JSON, type FetchJson } from '../src/renderer/rows'
import { conditions, readWeather } from '../src/renderer/weather'
import WeatherIcon from '../src/renderer/weather/WeatherIcon.vue'
import { setModelStore } from '../src/services'
import { useDocumentStore } from '../src/stores/document'
import { inst, model, page } from './helpers'

const PALM_BEACH = { place: 'Palm Beach, Florida', latitude: '26.7056', longitude: '-80.0364' }

/** An Open-Meteo forecast as the API returns it: today first, then the next days. */
const forecast = (current: Record<string, unknown> = { temperature_2m: 78.4, weather_code: 2, is_day: 1 }) => ({
  current_units: { temperature_2m: '°F' },
  current,
  daily: {
    time: ['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14'],
    weather_code: [0, 3, 63, 95],
    temperature_2m_max: [80, 84.4, 86.5, 85],
    temperature_2m_min: [70, 72, 69.2, 80],
  },
})

describe('reading the forecast', () => {
  it('rounds temperatures and names the next days, leaving today out', () => {
    expect(readWeather(forecast(), 3)).toEqual({
      temperature: 78,
      unit: '°F',
      conditions: { text: 'Partly cloudy', icon: 'partly-day' },
      forecast: [
        { day: 'Mon', high: 84, low: 72, conditions: { text: 'Overcast', icon: 'cloud' } },
        { day: 'Tue', high: 87, low: 69, conditions: { text: 'Rain', icon: 'rain' } },
        { day: 'Wed', high: 85, low: 80, conditions: { text: 'Thunderstorm', icon: 'storm' } },
      ],
    })
  })

  it('shows only the current weather without days, and the night icons after dark', () => {
    const now = readWeather(forecast({ temperature_2m: -0.4, weather_code: 0, is_day: 0 }), 0)
    expect(now).toMatchObject({ temperature: -0, conditions: { text: 'Clear', icon: 'clear-night' }, forecast: [] })
    expect(`${now.temperature}`).toBe('0')
  })

  it('skips days with missing figures and never shows more days than asked for', () => {
    const response = forecast()
    response.daily.temperature_2m_max[1] = null as unknown as number
    expect(readWeather(response, 3).forecast.map((d) => d.day)).toEqual(['Tue', 'Wed'])
    expect(readWeather(forecast(), 1).forecast.map((d) => d.day)).toEqual(['Mon'])
  })

  it('reads a missing day-or-night flag as day, and shows a date it can’t read as given', () => {
    const response = forecast({ temperature_2m: 70, weather_code: 0 })
    response.daily.time[1] = 'someday'
    const weather = readWeather(response, 3)
    expect(weather.conditions.icon).toBe('clear-day')
    expect(weather.forecast[0]!.day).toBe('someday')
  })

  it('refuses a response without a current temperature', () => {
    for (const response of [null, [], {}, { current: {} }, { current: { temperature_2m: '70' } }]) {
      expect(() => readWeather(response, 3)).toThrow('The response has no current temperature')
    }
  })

  it('knows every WMO code Open-Meteo documents, and says when it doesn’t', () => {
    const codes = [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]
    for (const code of codes) expect(conditions(code).text, String(code)).not.toBe('Unknown conditions')
    expect(conditions(42)).toEqual({ text: 'Unknown conditions', icon: 'cloud' })
    expect(conditions(1, false).icon).toBe('partly-night')
  })
})

describe('weather icons', () => {
  const names = ['clear-day', 'clear-night', 'partly-day', 'partly-night', 'cloud', 'fog', 'rain', 'snow', 'storm'] as const

  it.each(names)('%s is decorative plain SVG colored only with theme tokens', (name) => {
    const html = mount(WeatherIcon, { props: { name } }).html()
    expect(html).toMatch(/^<svg[^>]*aria-hidden="true"/)
    expect(html).not.toMatch(/<(script|foreignObject|image|use|a|iframe|style)\b|\son\w+=|href=/i)
    expect(html).toMatch(/<(path|circle)\b/)
    for (const [, style] of html.matchAll(/\sstyle="([^"]*)"/g)) {
      for (const declaration of style!.split(';').filter((d) => d.trim() !== '')) expect(declaration.trim()).toMatch(/^(fill|stroke): var\(--fd-(accent-solid|muted|sunken)\)$/)
    }
  })

  it('draws each one differently', () => {
    const drawings = names.map((name) => mount(WeatherIcon, { props: { name } }).html())
    expect(new Set(drawings).size).toBe(names.length)
  })
})

describe('the Weather card', () => {
  const render = (m: AppModel, fetchJson: FetchJson) => mount(DocumentView, { props: { root: generate(m).root }, global: { provide: { [FETCH_JSON as symbol]: fetchJson } } })
  const url = openMeteoUrl(26.7056, -80.0364, 'fahrenheit', 3)

  it('shows the temperature and conditions now, then the next days, named for screen readers', async () => {
    const fetchJson = vi.fn<FetchJson>(async () => forecast())
    const w = render(model(page(), inst('WeatherFeature', 'w', { ...PALM_BEACH, title: 'Where it’s Warm' })), fetchJson)
    expect(w.get('.fd-weather').attributes('aria-busy')).toBe('true')
    await flushPromises()
    expect(fetchJson.mock.calls).toEqual([[url]])
    const card = w.get('[data-feature-id="w"]')
    expect(card.get('.fd-heading').text()).toBe('Where it’s Warm')
    const weather = card.get('.fd-weather')
    expect(weather.attributes()).toMatchObject({ 'aria-label': 'Weather in Palm Beach, Florida' })
    expect(weather.attributes('aria-busy')).toBeUndefined()
    expect(weather.get('.fd-weather-temp').text()).toBe('78°F')
    expect(weather.get('.fd-weather-text').text()).toBe('Partly cloudy')
    // As a screen reader reads them: the conditions are hidden text beside the icons.
    expect(weather.findAll('.fd-weather-day').map((d) => d.text())).toEqual(['Mon: Overcast, high 84°, low 72°', 'Tue: Rain, high 87°, low 69°', 'Wed: Thunderstorm, high 85°, low 80°'])
    expect(card.get('a').attributes('href')).toBe('https://open-meteo.com/')
  })

  it('tells screen readers it is loading', async () => {
    const w = render(model(page(), inst('WeatherFeature', 'w', PALM_BEACH)), () => new Promise(() => {}))
    expect(w.get('.fd-weather').text()).toBe('Loading the weather…')
  })

  it('makes one request for two cards showing the same place', async () => {
    const fetchJson = vi.fn<FetchJson>(async () => forecast())
    const w = render(model(page(), inst('WeatherFeature', 'a', PALM_BEACH), inst('WeatherFeature', 'b', PALM_BEACH)), fetchJson)
    await flushPromises()
    expect(fetchJson).toHaveBeenCalledTimes(1)
    expect(w.findAll('.fd-weather-temp').map((t) => t.text())).toEqual(['78°F', '78°F'])
  })

  it('says what went wrong, naming the site, and tries again on request', async () => {
    const fetchJson = vi.fn<FetchJson>().mockRejectedValueOnce(new Error('503 Service Unavailable')).mockResolvedValueOnce(forecast())
    const w = render(model(page(), inst('WeatherFeature', 'w', PALM_BEACH)), fetchJson)
    await flushPromises()
    const alert = w.get('[role="alert"]')
    expect(alert.text()).toContain("Couldn't load the weather")
    expect(alert.text()).toContain('api.open-meteo.com: 503 Service Unavailable')
    await alert.get('button').trigger('click')
    await flushPromises()
    expect(w.find('[role="alert"]').exists()).toBe(false)
    expect(w.get('.fd-weather-temp').text()).toBe('78°F')
  })

  it('treats a response it can’t read as an error', async () => {
    const w = render(model(page(), inst('WeatherFeature', 'w', PALM_BEACH)), async () => ({ error: true, reason: 'Latitude must be in range' }))
    await flushPromises()
    expect(w.get('[role="alert"]').text()).toContain('The response has no current temperature')
  })

  it('without a location fetches nothing', async () => {
    const fetchJson = vi.fn<FetchJson>(async () => forecast())
    const w = render(model(page(), inst('WeatherFeature', 'w', { place: 'Nowhere' })), fetchJson)
    await flushPromises()
    expect(fetchJson).not.toHaveBeenCalled()
    expect(w.get('.fd-weather').text()).toBe('No location chosen yet.')
  })

  it('shows °C when that is chosen, even if the response gives no unit', async () => {
    const response = { ...forecast(), current_units: {} }
    const w = render(model(page(), inst('WeatherFeature', 'w', { ...PALM_BEACH, units: 'celsius', show: 'current' })), async () => response)
    await flushPromises()
    expect(w.get('.fd-weather-temp').text()).toBe('78°C')
    expect(w.find('.fd-weather-days').exists()).toBe(false)
  })
})

describe('finding a place', () => {
  const portland = {
    results: [
      { name: 'Portland', latitude: 45.52345, longitude: -122.67621, country: 'United States', admin1: 'Oregon' },
      { name: 'Portland', latitude: 43.66147, longitude: -70.25533, country: 'United States', admin1: 'Maine' },
      { name: 'Singapore', latitude: 1.28967, longitude: 103.85007, country: 'Singapore', admin1: 'Singapore' },
      { name: 'Nowhere', latitude: 200, longitude: 0 },
      { latitude: 1, longitude: 1 },
    ],
  }

  it('reads the search results into named places with rounded coordinates', () => {
    expect(placeSearchUrl(' Portland ')).toBe('https://geocoding-api.open-meteo.com/v1/search?name=Portland&count=5&language=en&format=json')
    expect(readPlaces(portland)).toEqual([
      { name: 'Portland, Oregon', detail: 'Oregon, United States', latitude: '45.5234', longitude: '-122.6762' },
      { name: 'Portland, Maine', detail: 'Maine, United States', latitude: '43.6615', longitude: '-70.2553' },
      { name: 'Singapore', detail: 'Singapore, Singapore', latitude: '1.2897', longitude: '103.8501' },
    ])
    expect(readPlaces({ generationtime_ms: 0.4 })).toEqual([])
    expect(() => readPlaces({ results: 'x' })).toThrow('not a place search result')
  })

  const field = (fetchJson: FetchJson, value = 'Reykjavik, Iceland') =>
    mount(PlaceSearchField, {
      props: { id: 'place', labelledby: 'place-label', value, latitude: '64.1', longitude: '-21.9' },
      global: { provide: { [FETCH_JSON as symbol]: fetchJson } },
    })

  it('shows the place, finds others, and picks one', async () => {
    const fetchJson = vi.fn<FetchJson>(async () => portland)
    const w = field(fetchJson)
    expect(w.get('[data-testid="place-summary"]').text()).toBe('Reykjavik, Iceland · 64.1, -21.9')
    expect(w.get('[data-testid="find-place"]').attributes('disabled')).toBeDefined()
    await w.get('input').setValue('Portland')
    await w.get('input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(fetchJson.mock.calls).toEqual([[placeSearchUrl('Portland')]])
    const results = w.get('[aria-label="Places found"]').findAll('button')
    expect(results.map((b) => b.get('span').text())).toEqual(['Portland, Oregon', 'Portland, Maine', 'Singapore'])
    expect(w.get('[data-testid="place-announcement"]').text()).toBe('3 places found for “Portland”.')
    await results[1]!.trigger('click')
    expect(w.emitted('pick')).toEqual([[{ name: 'Portland, Maine', detail: 'Maine, United States', latitude: '43.6615', longitude: '-70.2553' }]])
    expect(w.find('[aria-label="Places found"]').exists()).toBe(false)
    expect(w.get('[data-testid="place-announcement"]').text()).toBe('Portland, Maine picked.')
  })

  it('keeps keyboard focus in the field after a pick removes the list', async () => {
    const w = mount(PlaceSearchField, {
      props: { id: 'place', labelledby: 'place-label', value: '', latitude: '', longitude: '' },
      global: { provide: { [FETCH_JSON as symbol]: async () => portland } },
      attachTo: document.body,
    })
    await w.get('input').setValue('Portland')
    await w.get('[data-testid="find-place"]').trigger('click')
    await flushPromises()
    const button = w.findAll('[aria-label="Places found"] button')[0]!
    ;(button.element as HTMLButtonElement).focus()
    await button.trigger('click')
    await flushPromises()
    expect(document.activeElement).toBe(w.get('input').element)
    w.unmount()
  })

  it('hides results once the box says something else, and searches again for a query changed mid-search', async () => {
    const answers: ((value: unknown) => void)[] = []
    const fetchJson = vi.fn<FetchJson>(() => new Promise((resolve) => answers.push(resolve)))
    const w = field(fetchJson)
    await w.get('input').setValue('Portland')
    await w.get('input').trigger('keydown', { key: 'Enter' })
    // Corrected while the first search runs: Find is busy, but the answer for "Portland" leads to a search for "Paris".
    await w.get('input').setValue('Paris')
    await w.get('input').trigger('keydown', { key: 'Enter' })
    answers[0]!(portland)
    await flushPromises()
    expect(fetchJson.mock.calls.map(([url]) => url)).toEqual([placeSearchUrl('Portland'), placeSearchUrl('Paris')])
    answers[1]!({ results: [{ name: 'Paris', latitude: 48.85341, longitude: 2.3488, country: 'France', admin1: 'Île-de-France' }] })
    await flushPromises()
    expect(w.findAll('[aria-label="Places found"] button').map((b) => b.get('span').text())).toEqual(['Paris, Île-de-France'])
    await w.get('input').setValue('Pari')
    expect(w.find('[aria-label="Places found"]').exists()).toBe(false)
    await w.get('input').setValue('Paris ')
    expect(w.find('[aria-label="Places found"]').exists()).toBe(true)
  })

  it('says when nothing was found, or when the search failed', async () => {
    const w = field(async () => ({}))
    await w.get('input').setValue('Xyzzy')
    await w.get('[data-testid="find-place"]').trigger('click')
    await flushPromises()
    expect(w.get('[data-testid="no-places"]').text()).toBe('No places found for “Xyzzy”.')
    expect(w.get('[role="status"]').text()).toBe('No places found for “Xyzzy”.')

    const failing = field(async () => {
      throw new Error('Failed to fetch')
    })
    await failing.get('input').setValue('Portland')
    await failing.get('[data-testid="find-place"]').trigger('click')
    await flushPromises()
    expect(failing.get('[role="alert"]').text()).toBe("Couldn't search for places (Failed to fetch). You can type the coordinates below instead.")
  })

  it('ignores a search answered after the query changed', async () => {
    let answer: (value: unknown) => void = () => {}
    const w = field(() => new Promise((resolve) => (answer = resolve)))
    await w.get('input').setValue('Portland')
    await w.get('[data-testid="find-place"]').trigger('click')
    await w.get('input').setValue('Paris')
    answer(portland)
    await flushPromises()
    expect(w.find('[aria-label="Places found"]').exists()).toBe(false)
  })

  it('sets the place and its coordinates in one undo step from the inspector', async () => {
    setActivePinia(createPinia())
    const store = new MemoryModelStore()
    setModelStore(store)
    const doc = useDocumentStore()
    doc.editing = true
    await doc.load(await store.create(model(page(), inst('WeatherFeature', 'w', PALM_BEACH))))
    doc.select('w')
    const w = mount(Inspector, { global: { provide: { [FETCH_JSON as symbol]: async () => portland } } })
    const group = w.get('[data-testid="place-search"]')
    expect(w.get(`#${group.attributes('aria-labelledby')}`).text()).toBe('Place')
    await group.get('input').setValue('Portland')
    await group.get('[data-testid="find-place"]').trigger('click')
    await flushPromises()
    await group.findAll('[aria-label="Places found"] button')[1]!.trigger('click')
    const inputs = () => doc.model!.features.find((f) => f.id === 'w')!.inputs
    expect(inputs()).toMatchObject({ place: 'Portland, Maine', latitude: '43.6615', longitude: '-70.2553' })
    doc.undo()
    expect(inputs()).toMatchObject(PALM_BEACH)
  })

  it('applies typed coordinates when the field is left, not on every keystroke', async () => {
    setActivePinia(createPinia())
    const store = new MemoryModelStore()
    setModelStore(store)
    const doc = useDocumentStore()
    doc.editing = true
    await doc.load(await store.create(model(page(), inst('WeatherFeature', 'w', PALM_BEACH))))
    doc.select('w')
    const w = mount(Inspector, { global: { provide: { [FETCH_JSON as symbol]: async () => forecast() } } })
    const latitude = w.get('#input-latitude')
    ;(latitude.element as HTMLInputElement).value = '4'
    await latitude.trigger('input')
    const inputs = () => doc.model!.features.find((f) => f.id === 'w')!.inputs
    expect(inputs().latitude).toBe('26.7056')
    ;(latitude.element as HTMLInputElement).value = '41.5'
    await latitude.trigger('change')
    expect(inputs().latitude).toBe('41.5')
  })
})

beforeEach(() => vi.restoreAllMocks())
