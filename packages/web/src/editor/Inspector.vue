<script setup lang="ts">
import { canPlace, defaultRegistry, removeFeature, type InputValue } from '@feature-domain/engine'
import { computed } from 'vue'
import { useDocumentStore } from '../stores/document'
import DiagnosticsList from '../views/DiagnosticsList.vue'
import InputField from './InputField.vue'

const store = useDocumentStore()

const instance = computed(() => store.model?.features.find((f) => f.id === store.selectedId))
const def = computed(() => (instance.value ? defaultRegistry.get(instance.value.feature) : undefined))
const meta = computed(() => store.result?.metadata.features.find((f) => f.id === store.selectedId))
const diagnostics = computed(() => store.result?.diagnostics.filter((d) => d.featureInstanceId === store.selectedId) ?? [])

const encode = (parent: string, slot: string) => `${parent}\u0000${slot}`

/** Slots the selected feature may move to, plus where it is now. */
const locations = computed(() => {
  const model = store.model
  const result = store.result
  const id = store.selectedId
  if (!model || !result || id === null || def.value?.placement !== 'required') return []
  return result.metadata.targets
    .filter((t) => {
      const here = instance.value?.placement?.parent === t.parent && instance.value.placement.slot === t.slot
      return here || canPlace(model, { id }, t, { result }).ok
    })
    .map((t) => ({ value: encode(t.parent, t.slot), label: t.label }))
})
const location = computed(() => {
  const p = instance.value?.placement
  return p ? encode(p.parent, p.slot) : ''
})

function moveTo(value: string) {
  const [parent, slot] = value.split('\u0000')
  if (store.selectedId !== null && parent !== undefined && slot !== undefined) store.moveTo(store.selectedId, { parent, slot })
}

/** Options for a reference input: features of the accepted types. */
function references(accepts: string[] | undefined) {
  return (store.model?.features ?? [])
    .filter((f) => f.id !== store.selectedId && (!accepts || accepts.includes(f.feature)))
    .map((f) => ({ id: f.id, label: `${typeof f.inputs.name === 'string' && f.inputs.name ? f.inputs.name : f.feature} (#${f.id})` }))
}

function change(name: string, value: InputValue | undefined) {
  if (store.selectedId !== null) store.setInputs(store.selectedId, { [name]: value })
}

function remove() {
  const model = store.model
  const id = store.selectedId
  if (!model || id === null) return
  const preview = removeFeature(model, id)
  const label = meta.value?.name || def.value?.name || instance.value?.feature
  const lines = [`Delete "${label}"?`]
  if (preview.removed.length > 1) lines.push(`${preview.removed.length - 1} feature(s) inside it will be deleted too.`)
  for (const broken of preview.brokenReferences) lines.push(`Feature ${broken.id} will lose its reference to ${broken.references.join(', ')}.`)
  if (window.confirm(lines.join('\n'))) store.remove(id)
}
</script>

<template>
  <section aria-labelledby="inspector-heading" data-testid="inspector">
    <h2 id="inspector-heading" class="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Inspector</h2>
    <p v-if="!instance" class="text-sm text-slate-500">Select a feature on the page or in the tree.</p>
    <div v-else class="space-y-3">
      <div class="flex items-baseline justify-between gap-2">
        <p class="font-medium">
          {{ def?.name ?? instance.feature }} <span class="font-mono text-xs text-slate-400">#{{ instance.id }}</span>
        </p>
        <button type="button" class="text-sm text-red-700 hover:underline" data-testid="delete-feature" @click="remove">Delete</button>
      </div>

      <DiagnosticsList v-if="diagnostics.length > 0" :diagnostics="diagnostics" />

      <p v-if="!def" class="text-sm text-slate-600">
        {{ instance.feature }} is not ported yet. Its legacy settings are kept, so it can be migrated once it is.
      </p>
      <template v-else>
        <div v-if="def.placement === 'required'" class="space-y-1">
          <label for="input-location" class="block text-xs font-medium text-slate-600">Location</label>
          <select
            id="input-location"
            class="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
            :value="location"
            @change="moveTo(($event.target as HTMLSelectElement).value)"
          >
            <option v-if="location === ''" value="" disabled>Not placed</option>
            <option v-else-if="!locations.some((o) => o.value === location)" :value="location" disabled>
              Missing: {{ instance.placement?.parent }} › {{ instance.placement?.slot }}
            </option>
            <option v-for="option in locations" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </div>
        <InputField
          v-for="input in def.inputs"
          :key="`${instance.id}:${input.name}`"
          :def="input"
          :value="instance.inputs[input.name]"
          :references="input.type === 'reference' ? references(input.accepts) : undefined"
          @change="change(input.name, $event)"
        />
      </template>
    </div>
  </section>
</template>
