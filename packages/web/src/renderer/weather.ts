// Reads Open-Meteo's forecast (see the engine's `openMeteoUrl`) into what a Weather card shows.

export type WeatherIconName = 'clear-day' | 'clear-night' | 'partly-day' | 'partly-night' | 'cloud' | 'fog' | 'rain' | 'snow' | 'storm'

export interface Conditions {
  /** In words, e.g. "Light rain". */
  text: string
  icon: WeatherIconName
}

export interface DayForecast {
  /** The day's short name, e.g. "Tue". */
  day: string
  high: number
  low: number
  conditions: Conditions
}

export interface Weather {
  temperature: number
  /** "°F" or "°C", as the response gives it. */
  unit: string
  conditions: Conditions
  /** The days after today, at most `days`. */
  forecast: DayForecast[]
}

/** WMO weather interpretation codes, as Open-Meteo documents them, in words and as one of our icons. */
export function conditions(code: number, day = true): Conditions {
  const clear = day ? 'clear-day' : 'clear-night'
  const partly = day ? 'partly-day' : 'partly-night'
  const table: Record<number, [string, WeatherIconName]> = {
    0: ['Clear', clear],
    1: ['Mostly clear', partly],
    2: ['Partly cloudy', partly],
    3: ['Overcast', 'cloud'],
    45: ['Fog', 'fog'],
    48: ['Freezing fog', 'fog'],
    51: ['Light drizzle', 'rain'],
    53: ['Drizzle', 'rain'],
    55: ['Heavy drizzle', 'rain'],
    56: ['Freezing drizzle', 'rain'],
    57: ['Freezing drizzle', 'rain'],
    61: ['Light rain', 'rain'],
    63: ['Rain', 'rain'],
    65: ['Heavy rain', 'rain'],
    66: ['Freezing rain', 'rain'],
    67: ['Freezing rain', 'rain'],
    71: ['Light snow', 'snow'],
    73: ['Snow', 'snow'],
    75: ['Heavy snow', 'snow'],
    77: ['Snow grains', 'snow'],
    80: ['Light showers', 'rain'],
    81: ['Showers', 'rain'],
    82: ['Heavy showers', 'rain'],
    85: ['Snow showers', 'snow'],
    86: ['Heavy snow showers', 'snow'],
    95: ['Thunderstorm', 'storm'],
    96: ['Thunderstorm with hail', 'storm'],
    99: ['Thunderstorm with hail', 'storm'],
  }
  const [text, icon] = table[code] ?? ['Unknown conditions', 'cloud']
  return { text, icon }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** "2026-10-13" -> "Tue". Read as a calendar date: the forecast's dates are already the place's own. */
function dayName(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
}

/** The weather in an Open-Meteo forecast response; throws when it doesn't hold the current temperature. */
export function readWeather(response: unknown, days: number): Weather {
  const current = isRecord(response) && isRecord(response.current) ? response.current : undefined
  if (!current || !isNumber(current.temperature_2m)) throw new Error('The response has no current temperature')
  const units = isRecord(response) && isRecord(response.current_units) ? response.current_units : {}
  const unit = typeof units.temperature_2m === 'string' ? units.temperature_2m : ''
  const code = isNumber(current.weather_code) ? current.weather_code : -1
  const weather: Weather = { temperature: Math.round(current.temperature_2m), unit, conditions: conditions(code, current.is_day !== 0), forecast: [] }

  const daily = isRecord(response) && isRecord(response.daily) ? response.daily : undefined
  if (daily && days > 0) {
    const list = (key: string): unknown[] => (Array.isArray(daily[key]) ? (daily[key] as unknown[]) : [])
    const [time, codes, highs, lows] = [list('time'), list('weather_code'), list('temperature_2m_max'), list('temperature_2m_min')]
    // Today is the first day; the forecast shows the ones after it.
    for (let i = 1; i < time.length && weather.forecast.length < days; i++) {
      const [date, high, low, code] = [time[i], highs[i], lows[i], codes[i]]
      if (typeof date !== 'string' || !isNumber(high) || !isNumber(low)) continue
      weather.forecast.push({ day: dayName(date), high: Math.round(high), low: Math.round(low), conditions: conditions(isNumber(code) ? code : -1) })
    }
  }
  return weather
}
