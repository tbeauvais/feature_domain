<script setup lang="ts">
import type { DocNodeOf } from '@feature-domain/engine'
import { computed, toRef } from 'vue'
import { useDataStore } from '../data'
import { readWeather, type Weather } from '../weather'
import WeatherIcon from '../weather/WeatherIcon.vue'

// A Weather card's forecast: the temperature and conditions now, then the next days. Fetched through the page's data
// store, so two cards for the same place share one request.
const props = defineProps<{ node: DocNodeOf<'weather'> }>()
const store = useDataStore()
const state = store.json(toRef(() => props.node.props.url))

const read = computed((): { weather: Weather } | { problem: string } | undefined => {
  const s = state.value
  if (s.status !== 'loaded') return undefined
  try {
    return { weather: readWeather(s.response, props.node.props.days) }
  } catch (error) {
    return { problem: error instanceof Error ? error.message : String(error) }
  }
})
const weather = computed(() => (read.value && 'weather' in read.value ? read.value.weather : undefined))
const problem = computed(() => (state.value.status === 'error' ? state.value.message : read.value && 'problem' in read.value ? read.value.problem : undefined))
const unit = computed(() => weather.value?.unit || (props.node.props.units === 'celsius' ? '°C' : '°F'))
const host = computed(() => {
  try {
    return new URL(props.node.props.url ?? '').host
  } catch {
    return ''
  }
})
const label = computed(() => (props.node.props.place ? `Weather in ${props.node.props.place}` : 'Weather'))
</script>

<template>
  <section class="fd-weather" :aria-label="label" :aria-busy="state.status === 'loading' ? 'true' : undefined">
    <p v-if="!node.props.url" class="fd-weather-state fd-weather-state-text">No location chosen yet.</p>
    <div v-else-if="problem !== undefined" class="fd-weather-state" role="alert">
      <p class="fd-weather-state-title">Couldn't load the weather</p>
      <p class="fd-weather-state-text">{{ host ? `${host}: ` : '' }}{{ problem }}</p>
      <button type="button" class="fd-weather-retry" @click="store.refetch(node.props.url)">Try again</button>
    </div>
    <div v-else-if="!weather" class="fd-weather-skeleton" aria-hidden="true" />
    <template v-else>
      <div class="fd-weather-now">
        <WeatherIcon :name="weather.conditions.icon" />
        <p class="fd-weather-temp">{{ weather.temperature }}{{ unit }}</p>
        <p class="fd-weather-text">{{ weather.conditions.text }}</p>
      </div>
      <ul v-if="weather.forecast.length > 0" class="fd-weather-days">
        <li v-for="day in weather.forecast" :key="day.day" class="fd-weather-day">
          <span class="fd-weather-day-name">{{ day.day }}</span>
          <WeatherIcon :name="day.conditions.icon" />
          <span class="fd-visually-hidden">: {{ day.conditions.text }}, high </span>
          <span class="fd-weather-high">{{ day.high }}°</span>
          <span class="fd-visually-hidden">, low </span>
          <span class="fd-weather-low">{{ day.low }}°</span>
        </li>
      </ul>
    </template>
  </section>
</template>
