<!--
  A rising scatter with a trend line over a dot grid. Two layers, so the banner can be any height: the grid fills the
  frame (cropped), and the scatter always fits whole, centred.
-->
<script setup lang="ts">
import { useId } from 'vue'

// Pattern ids must be unique in the document, which may show this banner more than once.
const uid = `fd-${useId()}`
</script>

<template>
  <svg viewBox="0 0 1600 500" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <rect style="fill: var(--fd-band)" width="1600" height="500" />
    <defs>
      <pattern :id="`${uid}-dots`" width="32" height="32" patternUnits="userSpaceOnUse"><circle cx="16" cy="16" r="2.5" style="fill: var(--fd-band-accent)" fill-opacity="0.2" /></pattern>
    </defs>
    <rect width="1600" height="500" :style="{ fill: `url(#${uid}-dots)` }" />
  </svg>
  <svg viewBox="600 70 1000 360" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
    <g style="fill: var(--fd-band-muted)" fill-opacity="0.45"><circle cx="640" cy="400" r="8" /><circle cx="700" cy="330" r="6" /><circle cx="980" cy="400" r="7" /><circle cx="1120" cy="350" r="9" /><circle cx="1300" cy="280" r="7" /><circle cx="1440" cy="250" r="8" /><circle cx="1540" cy="200" r="6" /></g>
    <path style="stroke: var(--fd-band-accent)" d="M700 410 C 1000 340, 1220 250, 1560 90" fill="none" stroke-width="3" stroke-opacity="0.75" />
    <g style="fill: var(--fd-accent-solid)"><circle cx="760" cy="380" r="10" /><circle cx="840" cy="350" r="14" /><circle cx="920" cy="362" r="9" /><circle cx="1000" cy="300" r="16" /><circle cx="1080" cy="312" r="11" /><circle cx="1160" cy="252" r="18" /><circle cx="1240" cy="232" r="12" /><circle cx="1320" cy="182" r="20" /><circle cx="1400" cy="170" r="13" /><circle cx="1480" cy="122" r="22" /></g>
  </svg>
</template>
