<!--
  A drafted part with dimensions and a title block on a blueprint grid. Two layers, so the banner can be any height:
  the grid fills the frame (cropped), and the drawing always fits whole, centred.
-->
<script setup lang="ts">
import { useId } from 'vue'

// Pattern ids must be unique in the document, which may show this banner more than once.
const uid = `fd-${useId()}`
</script>

<template>
  <svg viewBox="0 0 1600 500" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <defs>
      <pattern :id="`${uid}-minor`" width="40" height="40" patternUnits="userSpaceOnUse"><path style="stroke: var(--fd-band-accent)" d="M40 0H0V40" fill="none" stroke-opacity="0.12" /></pattern>
      <pattern :id="`${uid}-major`" width="200" height="200" patternUnits="userSpaceOnUse"><path style="stroke: var(--fd-band-accent)" d="M200 0H0V200" fill="none" stroke-opacity="0.24" stroke-width="1.5" /></pattern>
    </defs>
    <rect style="fill: var(--fd-band)" width="1600" height="500" />
    <rect width="1600" height="500" :style="{ fill: `url(#${uid}-minor)` }" />
    <rect width="1600" height="500" :style="{ fill: `url(#${uid}-major)` }" />
  </svg>
  <svg viewBox="60 50 1290 420" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
    <circle style="stroke: var(--fd-accent-solid)" cx="300" cy="200" r="110" fill="none" stroke-width="2.5" stroke-dasharray="6 8" />
    <path style="stroke: var(--fd-band-accent)" d="M300 70 V330 M170 200 H430" stroke-opacity="0.6" stroke-width="1.5" stroke-dasharray="14 6 3 6" />
    <rect style="stroke: var(--fd-band-accent)" x="80" y="372" width="380" height="84" fill="none" stroke-opacity="0.55" stroke-width="1.5" />
    <path style="stroke: var(--fd-band-accent)" d="M80 414 H460 M300 372 V456" stroke-opacity="0.55" stroke-width="1.5" />
    <g font-size="16" fill-opacity="0.8">
      <text x="96" y="400" style="font-family: var(--fd-font-mono); fill: var(--fd-band-accent)">PART 001</text>
      <text x="316" y="400" style="font-family: var(--fd-font-mono); fill: var(--fd-band-accent)">REV A</text>
      <text x="96" y="442" style="font-family: var(--fd-font-mono); fill: var(--fd-band-accent)">SCALE 1:2</text>
      <text x="316" y="442" style="font-family: var(--fd-font-mono); fill: var(--fd-band-accent)">SHEET 1/1</text>
    </g>
    <path style="fill: var(--fd-accent-solid); stroke: var(--fd-accent-solid)" d="M960 140 H1320 V230 H1100 V400 H960 Z" fill-opacity="0.16" stroke-width="4" stroke-linejoin="round" />
    <circle style="stroke: var(--fd-accent-solid)" cx="1030" cy="200" r="26" fill="none" stroke-width="4" />
    <circle style="stroke: var(--fd-accent-solid)" cx="1240" cy="185" r="18" fill="none" stroke-width="4" />
    <path style="stroke: var(--fd-band-accent)" d="M1030 150 V250 M980 200 H1080 M1240 152 V218 M1206 185 H1274" stroke-opacity="0.65" stroke-width="1.5" stroke-dasharray="14 6 3 6" />
    <path style="stroke: var(--fd-band-accent)" d="M960 128 V78 M1320 128 V78 M960 90 H1320 M948 140 H888 M948 400 H888 M900 140 V400" fill="none" stroke-width="2" />
    <path style="fill: var(--fd-band-accent)" d="M960 90 l16 -6 v12 z M1320 90 l-16 -6 v12 z M900 140 l-6 16 h12 z M900 400 l-6 -16 h12 z" />
    <rect style="fill: var(--fd-band)" x="1110" y="62" width="60" height="28" />
    <text x="1140" y="84" text-anchor="middle" font-size="22" style="font-family: var(--fd-font-mono); fill: var(--fd-band-accent)">360</text>
    <text x="880" y="270" text-anchor="middle" font-size="22" transform="rotate(-90 880 270)" style="font-family: var(--fd-font-mono); fill: var(--fd-band-accent)">260</text>
    <path style="stroke: var(--fd-band-accent)" d="M1050 182 L1108 124 H1176" fill="none" stroke-width="2" />
    <text x="1184" y="131" font-size="20" style="font-family: var(--fd-font-mono); fill: var(--fd-band-accent)">&#216; 52</text>
  </svg>
</template>
