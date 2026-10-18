import { describe, expect, it } from 'vitest'
import { createFeatureInstance, defaultRegistry, FORECAST_DAYS, generate, migrate, OPEN_METEO_CREDIT, openMeteoUrl, readCoordinate } from '../src'
import { inst, model, page } from './helpers'

const PALM_BEACH = { place: 'Palm Beach, Florida', latitude: '26.7056', longitude: '-80.0364' }

const card = (inputs: Record<string, string | boolean>) => {
  const r = generate(model(page(), inst('WeatherFeature', 'w', inputs)))
  return { card: r.root.children[0]!.children[0], problems: r.diagnostics.map((d) => d.message) }
}

describe('WeatherFeature', () => {
  it('is a card: the place as its title, the weather, and the credit Open-Meteo asks for', () => {
    const { card: c, problems } = card(PALM_BEACH)
    expect(problems).toEqual([])
    expect(c!.kind).toBe('card')
    expect(c!.children.map((n) => [n.kind, n.id, n.props])).toEqual([
      ['heading', 'w.title', { text: 'Palm Beach, Florida', level: 4, align: 'left' }],
      [
        'weather',
        'w.weather',
        { place: 'Palm Beach, Florida', units: 'fahrenheit', days: FORECAST_DAYS, url: openMeteoUrl(26.7056, -80.0364, 'fahrenheit', FORECAST_DAYS) },
      ],
      ['link', 'w.credit', OPEN_METEO_CREDIT],
    ])
  })

  it('takes a title of its own over the place name', () => {
    const { card: c } = card({ ...PALM_BEACH, title: ' Where it’s Warm ' })
    expect(c!.children[0]!.props).toMatchObject({ text: 'Where it’s Warm' })
  })

  it('asks Open-Meteo for the units chosen, and for daily figures only when it shows the next days', () => {
    expect(openMeteoUrl(26.70561234, -80.0364, 'celsius', 0)).toBe(
      'https://api.open-meteo.com/v1/forecast?latitude=26.7056&longitude=-80.0364&current=temperature_2m,weather_code,is_day&temperature_unit=celsius&timezone=auto&forecast_days=1',
    )
    expect(openMeteoUrl(41.289, -72.6818, 'fahrenheit', 3)).toBe(
      'https://api.open-meteo.com/v1/forecast?latitude=41.289&longitude=-72.6818&current=temperature_2m,weather_code,is_day&temperature_unit=fahrenheit&timezone=auto&forecast_days=4&daily=weather_code,temperature_2m_max,temperature_2m_min',
    )
    const now = card({ ...PALM_BEACH, units: 'celsius', show: 'current' }).card!.children[1]!.props
    expect(now).toMatchObject({ units: 'celsius', days: 0, url: openMeteoUrl(26.7056, -80.0364, 'celsius', 0) })
  })

  it('falls back to °F and the forecast for values it doesn’t know', () => {
    expect(card({ ...PALM_BEACH, units: 'kelvin', show: 'week' }).card!.children[1]!.props).toMatchObject({ units: 'fahrenheit', days: FORECAST_DAYS })
  })

  it('without a usable location fetches nothing and says why', () => {
    const cases: [Record<string, string>, string][] = [
      [{ place: '' }, 'No location: use Find to pick a place'],
      [{ ...PALM_BEACH, latitude: '91' }, 'Latitude "91" is not a number from -90 to 90'],
      [{ ...PALM_BEACH, longitude: '-80.0364W' }, 'Longitude "-80.0364W" is not a number from -180 to 180'],
      [{ ...PALM_BEACH, latitude: '' }, 'Latitude "" is not a number from -90 to 90'],
    ]
    for (const [inputs, problem] of cases) {
      const { card: c, problems } = card(inputs)
      expect(problems).toEqual([problem])
      expect(c!.children.find((n) => n.kind === 'weather')!.props).not.toHaveProperty('url')
    }
  })

  it('reads coordinates as plain decimals within range', () => {
    expect(readCoordinate(' -72.6818 ', 180)).toBe(-72.6818)
    expect(readCoordinate('+90', 90)).toBe(90)
    expect(readCoordinate('.5', 90)).toBe(0.5)
    for (const bad of ['', '1e2', '0x10', 'NaN', 'Infinity', '12,5', '-90.01', undefined, null, true])
      expect(readCoordinate(bad, 90), String(bad)).toBeUndefined()
    expect(readCoordinate(41.289, 90)).toBe(41.289)
  })

  it('is hidden when disabled', () => {
    expect(card({ ...PALM_BEACH, disable: true }).card).toBeUndefined()
  })

  it('starts new Weather features on a real place, so they show weather at once', () => {
    const def = defaultRegistry.get('WeatherFeature')!
    const inputs = createFeatureInstance(def, '9').inputs
    expect(inputs).toMatchObject({ place: 'Guilford, Connecticut', latitude: '41.2890', longitude: '-72.6818', units: 'fahrenheit', show: 'forecast' })
    expect(generate(model(page(), { ...createFeatureInstance(def, '9', { parent: '1', slot: 'content' }) })).diagnostics).toEqual([])
  })

  it('has its coordinates applied when the field is left, since each value is a request', () => {
    const def = defaultRegistry.get('WeatherFeature')!
    expect(def.inputs.filter((i) => i.commitOnBlur).map((i) => i.name)).toEqual(['latitude', 'longitude'])
  })
})

describe('the legacy Yahoo weather resources', () => {
  const legacy = (resource: string) =>
    migrate({ features: [{ feature: 'DataResourceFeature', id: '21', inputs: { name: 'Weather Service', resource, operation: 'get' } }] }).notes

  it('are noted as a dead service, pointing at the Weather feature', () => {
    expect(
      legacy('https://query.yahooapis.com/v1/public/yql?q=select%20item.condition%20from%20weather.forecast').map((n) => [n.code, n.severity, n.message]),
    ).toEqual([
      ['dead-service', 'warning', "Yahoo's weather service shut down in 2019, so this resource loads nothing; use a Weather feature to show the weather"],
    ])
  })

  it('other addresses are not', () => {
    expect(legacy('https://api.github.com/users/tbeauvais/repos')).toEqual([])
  })
})
