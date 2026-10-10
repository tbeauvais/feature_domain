<script setup lang="ts">
// Line icons for feature types (inline SVG: the editor loads nothing from other sites). Unknown types get a square.
defineProps<{ type: string; size?: number }>()

const paths: Record<string, string> = {
  PageFeature: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6',
  ContainerFeature: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM12 3v18M3 12h18',
  PanelFeature: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM3 9h18',
  HeaderFeature: 'M6 4h12M6 20h12M12 4v16',
  TextFeature: 'M4 6h16M4 12h16M4 18h10',
  ImageFeature: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 7a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM21 15l-5-5L5 21',
  ListFeature: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  TextWithParagraphFeature: 'M4 5h10M4 10h16M4 14h16M4 18h11',
  ImageWithParagraphFeature: 'M3 5h7v7H3zM14 6h7M14 10h7M3 16h18M3 20h12',
  ListGroupFeature: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM7 8l1.5 1.5L11 7M13 8h4M7 13l1.5 1.5L11 12M13 13h4M7 18h10',
  LinkFeature: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  ButtonFeature: 'M6 7h12a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-4a3 3 0 0 1 3-3zM8 12h8',
  SeparatorFeature: 'M3 12h18M8 7h8M8 17h8',
  TableFeature: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM3 9h18M3 15h18M9 3v18',
  DataResourceFeature: 'M4 5c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  ThemeFeature:
    'M12 2a10 10 0 0 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A5.6 5.6 0 0 0 22 9.8C22 5.5 17.5 2 12 2zM7.5 12.5h.01M8.5 7.5h.01M13.5 6.5h.01M17.5 10.5h.01',
}
const fallback = 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z'
</script>

<template>
  <svg
    :width="size ?? 20"
    :height="size ?? 20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[type] ?? fallback" />
  </svg>
</template>
