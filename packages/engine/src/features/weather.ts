import type { FeatureDefinition } from '../feature.js'
import { asOneOf, asString, disableInput, nameInput } from '../inputs.js'
import { node } from '../nodes.js'
import type { DocNode } from '../types.js'
import { title } from './blocks.js'

export const WEATHER_UNITS = ['fahrenheit', 'celsius'] as const
export type WeatherUnits = (typeof WEATHER_UNITS)[number]
export const WEATHER_SHOW = ['current', 'forecast'] as const
/** Days the forecast shows after today. */
export const FORECAST_DAYS = 3

/** Open-Meteo's credit, which its data licence (CC BY 4.0) asks for beside the location. */
export const OPEN_METEO_CREDIT = { text: 'Weather data by Open-Meteo.com', href: 'https://open-meteo.com/' }

/** A latitude or longitude typed or stored as text: a plain decimal within `limit` either side of 0, else undefined. */
export function readCoordinate(value: unknown, limit: number): number | undefined {
  const text = asString(value).trim()
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(text)) return undefined
  const n = Number(text)
  return Math.abs(n) <= limit ? n : undefined
}

/**
 * Open-Meteo's forecast for a place: the current temperature and conditions, and with `days` the daily highs, lows and
 * conditions for today and the days after. No key; it allows browsers to fetch it. Coordinates are rounded to about
 * 10 m, which is finer than its grid.
 */
export function openMeteoUrl(latitude: number, longitude: number, units: WeatherUnits, days: number): string {
  // Built by hand: the engine uses no platform globals (URLSearchParams included). Every value here is URL-safe.
  const params: [string, string][] = [
    ['latitude', String(Number(latitude.toFixed(4)))],
    ['longitude', String(Number(longitude.toFixed(4)))],
    ['current', 'temperature_2m,weather_code,is_day'],
    ['temperature_unit', units],
    ['timezone', 'auto'],
    ['forecast_days', String(days + 1)],
  ]
  if (days > 0) params.push(['daily', 'weather_code,temperature_2m_max,temperature_2m_min'])
  return `https://api.open-meteo.com/v1/forecast?${params.map(([key, value]) => `${key}=${value}`).join('&')}`
}

/**
 * The weather at a place, from Open-Meteo (new; the legacy samples read Yahoo's weather service, shut down in 2019): a
 * card with a title (else the place's name), the temperature and conditions now, optionally the next days, and the
 * credit the data's licence asks for. The editor's Find stores the place's coordinates, so a page makes one request.
 */
export const WeatherFeature: FeatureDefinition = {
  type: 'WeatherFeature',
  name: 'Weather',
  icon: 'weather',
  placement: 'required',
  inputs: [
    nameInput('Weather'),
    disableInput,
    { name: 'title', label: 'Title', type: 'string', default: '', placeholder: 'The place’s name', control: 'text-input' },
    // New features start somewhere, so they show weather at once; Find changes all three together.
    { name: 'place', label: 'Place', type: 'string', default: '', initial: 'Guilford, Connecticut', control: 'place-search' },
    { name: 'latitude', label: 'Latitude', type: 'string', default: '', initial: '41.2890', control: 'text-input', group: 'Coordinates', commitOnBlur: true },
    { name: 'longitude', label: 'Longitude', type: 'string', default: '', initial: '-72.6818', control: 'text-input', group: 'Coordinates', commitOnBlur: true },
    {
      name: 'units',
      label: 'Units',
      type: 'string',
      default: 'fahrenheit',
      control: 'segmented',
      options: [
        { value: 'fahrenheit', text: '°F' },
        { value: 'celsius', text: '°C' },
      ],
    },
    {
      name: 'show',
      label: 'Show',
      type: 'string',
      default: 'forecast',
      control: 'segmented',
      options: [
        { value: 'current', text: 'Now' },
        { value: 'forecast', text: `Now and ${FORECAST_DAYS} days` },
      ],
    },
  ],

  generate(inputs, ctx) {
    const place = asString(inputs.place).trim()
    const units = asOneOf(inputs.units, WEATHER_UNITS, 'fahrenheit')
    const days = asOneOf(inputs.show, WEATHER_SHOW, 'forecast') === 'forecast' ? FORECAST_DAYS : 0
    const props: { url?: string; place: string; units: WeatherUnits; days: number } = { place, units, days }

    const latitude = readCoordinate(inputs.latitude, 90)
    const longitude = readCoordinate(inputs.longitude, 180)
    if (asString(inputs.latitude).trim() === '' && asString(inputs.longitude).trim() === '') ctx.report('warning', 'No location: use Find to pick a place')
    else if (latitude === undefined) ctx.report('warning', `Latitude "${asString(inputs.latitude)}" is not a number from -90 to 90`)
    else if (longitude === undefined) ctx.report('warning', `Longitude "${asString(inputs.longitude)}" is not a number from -180 to 180`)
    else props.url = openMeteoUrl(latitude, longitude, units, days)

    const children: DocNode[] = [
      // The place's name stands in for an empty title; only a title of its own is edited in place.
      ...(asString(inputs.title).trim() ? title(ctx, 'title', asString(inputs.title), 'title') : title(ctx, 'title', place)),
      node('weather', ctx.nodeId('weather'), props),
      node('link', ctx.nodeId('credit'), { ...OPEN_METEO_CREDIT }),
    ]
    return { node: node('card', ctx.nodeId(), {}, { children }) }
  },
}
