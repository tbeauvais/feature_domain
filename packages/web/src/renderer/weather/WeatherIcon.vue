<script setup lang="ts">
import type { WeatherIconName } from '../weather'

// Our own weather icons, drawn in the theme's colors like the illustrations. Decorative: the conditions are in words beside them.
defineProps<{ name: WeatherIconName }>()
const CLOUD = 'M15 36 H35 A7.5 7.5 0 0 0 36 21 A10.5 10.5 0 0 0 16.5 19.5 A8.25 8.25 0 0 0 15 36 Z'
const RAYS = 'M24 6 V10 M24 38 V42 M6 24 H10 M38 24 H42 M11.3 11.3 L14.1 14.1 M33.9 33.9 L36.7 36.7 M11.3 36.7 L14.1 33.9 M33.9 14.1 L36.7 11.3'
const MOON = 'M30 8 A16 16 0 1 0 40 30 A12.5 12.5 0 0 1 30 8 Z'
</script>

<template>
  <svg class="fd-weather-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <template v-if="name === 'clear-day'">
      <circle style="fill: var(--fd-accent-solid)" cx="24" cy="24" r="9" />
      <path style="stroke: var(--fd-accent-solid)" :d="RAYS" stroke-width="3" stroke-linecap="round" />
    </template>
    <path v-else-if="name === 'clear-night'" style="fill: var(--fd-muted)" :d="MOON" />
    <template v-else>
      <g v-if="name === 'partly-day'" transform="translate(-6 -7) scale(0.75)">
        <circle style="fill: var(--fd-accent-solid)" cx="24" cy="24" r="9" />
        <path style="stroke: var(--fd-accent-solid)" :d="RAYS" stroke-width="3.5" stroke-linecap="round" />
      </g>
      <path v-else-if="name === 'partly-night'" style="fill: var(--fd-muted)" :d="MOON" transform="translate(-4 -5) scale(0.7)" />
      <template v-if="name === 'fog'">
        <path style="stroke: var(--fd-muted)" d="M10 18 H38 M6 25 H34 M12 32 H40 M8 39 H30" stroke-width="3" stroke-linecap="round" />
      </template>
      <template v-else>
        <path style="fill: var(--fd-sunken); stroke: var(--fd-muted)" :d="CLOUD" :transform="name === 'cloud' || name.startsWith('partly') ? undefined : 'translate(0 -6)'" stroke-width="2" stroke-linejoin="round" />
        <path v-if="name === 'rain'" style="stroke: var(--fd-muted)" d="M18 35 L16 41 M25 35 L23 41 M32 35 L30 41" stroke-width="2.5" stroke-linecap="round" />
        <g v-else-if="name === 'snow'" style="fill: var(--fd-muted)">
          <circle cx="17" cy="38" r="2" />
          <circle cx="25" cy="41" r="2" />
          <circle cx="33" cy="38" r="2" />
        </g>
        <path v-else-if="name === 'storm'" style="fill: var(--fd-accent-solid)" d="M26 29 L19 39 H24 L21 46 L30 35 H25 L28 29 Z" />
      </template>
    </template>
  </svg>
</template>
