<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { browserFetchJson, FETCH_JSON } from '../renderer/rows'
import { placeSearchUrl, readPlaces, type Place } from './places'

// The Weather feature's Location: the place it shows, and Find to search for another. Picking a result sets the
// place's name and coordinates together (one undo step).
const props = defineProps<{ id: string; labelledby: string; value: string; latitude: string; longitude: string }>()
const emit = defineEmits<{ pick: [place: Place] }>()

const fetchJson = inject(FETCH_JSON, browserFetchJson)
const query = ref('')
const searching = ref(false)
const problem = ref('')
const places = ref<Place[] | undefined>(undefined)
const searched = ref('')

const summary = computed(() => {
  if (props.value.trim() === '' && props.latitude.trim() === '' && props.longitude.trim() === '') return 'No place chosen yet.'
  const where = [props.latitude.trim(), props.longitude.trim()].filter(Boolean).join(', ')
  return [props.value.trim() || 'Unnamed place', where].filter(Boolean).join(' · ')
})

async function find() {
  const q = query.value.trim()
  if (q === '' || searching.value) return
  searching.value = true
  problem.value = ''
  places.value = undefined
  try {
    const found = readPlaces(await fetchJson(placeSearchUrl(q)))
    // A search for something since replaced is ignored.
    if (query.value.trim() !== q) return
    places.value = found
    searched.value = q
  } catch (error) {
    if (query.value.trim() !== q) return
    problem.value = `Couldn't search for places (${error instanceof Error ? error.message : String(error)}). You can type the coordinates below instead.`
  } finally {
    searching.value = false
  }
}

function pick(place: Place) {
  emit('pick', place)
  places.value = undefined
  query.value = ''
}
</script>

<template>
  <div class="space-y-2" role="group" :aria-labelledby="labelledby" data-testid="place-search">
    <p class="text-sm text-slate-700" data-testid="place-summary">{{ summary }}</p>
    <div class="flex gap-2">
      <label :for="id" class="sr-only">Find a place</label>
      <input
        :id="id"
        v-model="query"
        type="search"
        class="w-full min-w-0 rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-sky-500 focus:outline-none"
        placeholder="City or town"
        @keydown.enter.prevent="find"
      />
      <button
        type="button"
        class="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50 disabled:opacity-40"
        :disabled="query.trim() === '' || searching"
        data-testid="find-place"
        @click="find"
      >
        {{ searching ? 'Finding…' : 'Find' }}
      </button>
    </div>
    <p v-if="problem" class="text-xs text-amber-800" role="alert">{{ problem }}</p>
    <p v-else-if="places && places.length === 0" class="text-xs text-slate-600" role="status">No places found for “{{ searched }}”.</p>
    <ul v-else-if="places" class="space-y-1" aria-label="Places found">
      <li v-for="place in places" :key="`${place.latitude},${place.longitude}`">
        <button type="button" class="w-full rounded-md px-2 py-1 text-left text-sm hover:bg-slate-100" @click="pick(place)">
          <span class="block text-slate-800">{{ place.name }}</span>
          <span class="block text-xs text-slate-500">{{ place.detail }} · {{ place.latitude }}, {{ place.longitude }}</span>
        </button>
      </li>
    </ul>
    <p class="text-xs text-slate-500">Place search by Open-Meteo.com</p>
  </div>
</template>
