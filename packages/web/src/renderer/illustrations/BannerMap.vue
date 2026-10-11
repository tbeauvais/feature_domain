<!--
  A street map: blocks, two parks (the accent tint) and a river (the border color, so the map reads the same in every
  theme), with a route to a pin. Two layers, so it suits any height: the streets fill the frame (cropped), and the
  route and pin always show whole, centered. The same drawing for every address (the Map feature shows the address
  beside it), so it is decorative there.
-->
<template>
  <svg viewBox="0 0 1600 1200" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <rect style="fill: var(--fd-bg)" width="1600" height="1200" />
    <g style="fill: var(--fd-sunken)">
      <rect x="12" y="12" width="226" height="176" rx="10" />
      <rect x="12" y="212" width="226" height="196" rx="10" />
      <rect x="12" y="432" width="226" height="142" rx="10" />
      <rect x="12" y="626" width="226" height="152" rx="10" />
      <rect x="12" y="802" width="226" height="186" rx="10" />
      <rect x="12" y="1012" width="226" height="176" rx="10" />
      <rect x="262" y="12" width="226" height="176" rx="10" />
      <rect x="262" y="212" width="226" height="196" rx="10" />
      <rect x="262" y="432" width="226" height="142" rx="10" />
      <rect x="262" y="626" width="226" height="152" rx="10" />
      <rect x="262" y="1012" width="226" height="176" rx="10" />
      <rect x="512" y="12" width="222" height="176" rx="10" />
      <rect x="512" y="212" width="222" height="196" rx="10" />
      <rect x="512" y="432" width="222" height="142" rx="10" />
      <rect x="512" y="626" width="222" height="152" rx="10" />
      <rect x="512" y="802" width="222" height="186" rx="10" />
      <rect x="512" y="1012" width="222" height="176" rx="10" />
      <rect x="786" y="12" width="242" height="176" rx="10" />
      <rect x="786" y="212" width="242" height="196" rx="10" />
      <rect x="786" y="432" width="242" height="142" rx="10" />
      <rect x="786" y="626" width="242" height="152" rx="10" />
      <rect x="786" y="802" width="242" height="186" rx="10" />
      <rect x="786" y="1012" width="242" height="176" rx="10" />
      <rect x="1052" y="12" width="236" height="176" rx="10" />
      <rect x="1052" y="432" width="236" height="142" rx="10" />
      <rect x="1052" y="626" width="236" height="152" rx="10" />
      <rect x="1052" y="802" width="236" height="186" rx="10" />
      <rect x="1052" y="1012" width="236" height="176" rx="10" />
      <rect x="1312" y="12" width="276" height="176" rx="10" />
      <rect x="1312" y="212" width="276" height="196" rx="10" />
      <rect x="1312" y="432" width="276" height="142" rx="10" />
      <rect x="1312" y="626" width="276" height="152" rx="10" />
      <rect x="1312" y="802" width="276" height="186" rx="10" />
      <rect x="1312" y="1012" width="276" height="176" rx="10" />
    </g>
    <g style="fill: var(--fd-accent-soft)">
      <rect x="262" y="802" width="226" height="186" rx="10" />
      <rect x="1052" y="212" width="236" height="196" rx="10" />
    </g>
    <path style="stroke: var(--fd-border)" d="M-40 140 C 260 260, 420 120, 640 300 S 980 980, 1240 1060 S 1520 1120, 1660 1260" fill="none" stroke-width="56" stroke-linecap="round" />
    <path style="stroke: var(--fd-bg)" d="M0 1180 L1600 60" fill="none" stroke-width="30" />
    <path style="stroke: var(--fd-border)" d="M760 0 V1200 M0 600 H1600" fill="none" stroke-width="2" stroke-dasharray="18 14" />
  </svg>
  <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
    <path style="stroke: var(--fd-accent-solid)" d="M96 236 C 130 214, 150 186, 176 176 S 206 160, 200 142" fill="none" stroke-width="5" stroke-linecap="round" stroke-dasharray="2 12" />
    <circle style="fill: var(--fd-ink)" cx="96" cy="236" r="8" />
    <circle style="fill: var(--fd-surface)" cx="96" cy="236" r="3" />
    <ellipse style="fill: var(--fd-ink)" cx="200" cy="146" rx="16" ry="5" fill-opacity="0.18" />
    <path style="fill: var(--fd-accent-solid)" d="M200 142 L176 112 A30 30 0 1 1 224 112 Z" />
    <circle style="fill: var(--fd-surface)" cx="200" cy="92" r="10" />
  </svg>
</template>
