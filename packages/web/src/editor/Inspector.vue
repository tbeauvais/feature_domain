<script setup lang="ts">
import { canPlace, defaultRegistry, isInputShown, removeFeature, usedBy, type InputDef, type InputValue } from '@feature-domain/engine'
import { computed } from 'vue'
import { useDocumentStore } from '../stores/document'
import { confirmAction } from './confirm'
import { siblingsIn } from './dnd'
import DiagnosticsList from '../views/DiagnosticsList.vue'
import InputField from './InputField.vue'
import ThemePresets from './ThemePresets.vue'
import { themeForFeature } from './themeFor'

const store = useDocumentStore()

const instance = computed(() => store.model?.features.find((f) => f.id === store.selectedId))
const def = computed(() => (instance.value ? defaultRegistry.get(instance.value.feature) : undefined))
const meta = computed(() => store.result?.metadata.features.find((f) => f.id === store.selectedId))
const diagnostics = computed(() => store.result?.diagnostics.filter((d) => d.featureInstanceId === store.selectedId) ?? [])

/** Inputs that apply to the current values (e.g. the image address only when Source is Link). */
const shownInputs = computed(() => (def.value && instance.value ? def.value.inputs.filter((i) => isInputShown(i, def.value!.inputs, instance.value!.inputs)) : []))
/** Inputs grouped into the feature's sections, in order; the ungrouped ones (name, disable, ...) come first. */
const sections = computed(() => {
  const out: { group: string | undefined; inputs: InputDef[] }[] = []
  for (const input of shownInputs.value) {
    const section = out.find((s) => s.group === input.group)
    if (section) section.inputs.push(input)
    else out.push({ group: input.group, inputs: [input] })
  }
  return out.sort((a, b) => (a.group === undefined ? -1 : b.group === undefined ? 1 : 0))
})

/** With nothing selected: the model in a line or two, and a way to add a theme when it has none. */
const summary = computed(() => {
  const features = store.model?.features ?? []
  const pages = features.filter((f) => f.feature === 'PageFeature').length
  const onPages = features.filter((f) => f.placement && f.feature !== 'PageFeature').length
  const themes = features.filter((f) => f.feature === 'ThemeFeature').length
  return {
    counts: `${pages} page${pages === 1 ? '' : 's'} · ${onPages === 0 ? `nothing on ${pages === 1 ? 'it' : 'them'} yet` : `${onPages} feature${onPages === 1 ? '' : 's'} on ${pages === 1 ? 'it' : 'them'}`}`,
    themes,
  }
})

const isTheme = computed(() => instance.value?.feature === 'ThemeFeature')

/** What uses the selected feature (pages on a theme, tables on a data resource), with labels. */
const users = computed(() => {
  const result = store.result
  if (!result || store.selectedId === null) return []
  return usedBy(result, store.selectedId).map((id) => {
    const feature = store.model?.features.find((f) => f.id === id)
    const type = feature ? (defaultRegistry.get(feature.feature)?.name ?? feature.feature) : ''
    const name = typeof feature?.inputs.name === 'string' && feature.inputs.name.trim() ? feature.inputs.name : type
    return { id, name, type }
  })
})
/** Pages whose theme is missing or not a Theme (they show the default theme). */
const unthemedPages = computed(() => {
  const features = store.model?.features ?? []
  const themes = new Set(features.filter((f) => f.feature === 'ThemeFeature').map((f) => f.id))
  return features.filter((f) => f.feature === 'PageFeature' && !(typeof f.inputs.theme === 'string' && themes.has(f.inputs.theme)))
})

/** "used by 2 pages", or "used by 3 features" when they differ in type. */
const usedBySummary = computed(() => {
  const list = users.value
  if (list.length === 0) return isTheme.value ? 'not used yet' : ''
  const types = new Set(list.map((u) => u.type))
  const noun = types.size === 1 ? [...types][0]!.toLowerCase() : 'feature'
  return `used by ${list.length} ${noun}${list.length === 1 ? '' : 's'}`
})

/** Previews in the inspector use the theme of the page the feature is on. */
const themeVars = computed(() => themeForFeature(store.result?.root, store.selectedId).vars)

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

/** Move up/down among siblings in the same slot: the keyboard alternative to dragging. */
const siblings = computed(() => {
  const p = instance.value?.placement
  return p && store.model ? siblingsIn(store.model, p.parent, p.slot) : []
})
const position = computed(() => (store.selectedId === null ? -1 : siblings.value.indexOf(store.selectedId)))
function moveBy(delta: -1 | 1) {
  const p = instance.value?.placement
  if (!p || store.selectedId === null || position.value < 0) return
  const others = siblings.value.filter((id) => id !== store.selectedId)
  const before = others[position.value + delta]
  store.moveTo(store.selectedId, before === undefined ? { parent: p.parent, slot: p.slot } : { parent: p.parent, slot: p.slot, before })
}

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

async function remove() {
  const model = store.model
  const id = store.selectedId
  if (!model || id === null) return
  const preview = removeFeature(model, id)
  const label = meta.value?.name || def.value?.name || instance.value?.feature
  const lines: string[] = []
  if (preview.removed.length > 1) lines.push(`${preview.removed.length - 1} feature(s) inside it will be deleted too.`)
  for (const broken of preview.brokenReferences) lines.push(`Feature ${broken.id} will lose its reference to ${broken.references.join(', ')}.`)
  lines.push('You can undo this.')
  const confirmed = await confirmAction({ title: `Delete "${label}"?`, description: lines.join('\n'), confirmLabel: 'Delete', destructive: true })
  if (confirmed && store.model === model) store.remove(id)
}
</script>

<template>
  <section aria-labelledby="inspector-heading" data-testid="inspector">
    <h2 id="inspector-heading" class="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Inspector</h2>
    <div v-if="!instance" class="space-y-3" data-testid="inspector-idle">
      <div>
        <p class="font-medium">Nothing selected</p>
        <p class="text-sm text-slate-600">Select a feature on the page or in the tree to edit its settings.</p>
      </div>
      <div v-if="store.model" class="space-y-1 border-t border-slate-200 pt-3 text-sm">
        <h3 class="font-semibold text-slate-800">This model</h3>
        <p class="text-slate-600">{{ summary.counts }}</p>
        <p v-if="summary.themes === 0" class="text-slate-600">
          Pages use the default theme (Warm Editorial).
          <button type="button" class="font-medium text-slate-900 underline hover:text-slate-700" data-testid="add-theme" @click="store.add('ThemeFeature')">
            Add a theme
          </button>
          to change colours and type.
        </p>
      </div>
    </div>
    <div v-else class="space-y-3">
      <div class="flex items-baseline justify-between gap-2">
        <div>
          <p class="font-medium">
            {{ def?.name ?? instance.feature }} <span class="font-mono text-xs text-slate-400">#{{ instance.id }}</span>
          </p>
          <p v-if="usedBySummary" class="text-xs text-slate-500" data-testid="used-by-summary">{{ usedBySummary }}</p>
        </div>
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
          <div v-if="siblings.length > 1" class="flex gap-1 pt-1">
            <button type="button" class="rounded border border-slate-300 px-2 py-0.5 text-xs disabled:opacity-40" data-testid="move-up" :disabled="position <= 0" @click="moveBy(-1)">
              Move up
            </button>
            <button
              type="button"
              class="rounded border border-slate-300 px-2 py-0.5 text-xs disabled:opacity-40"
              data-testid="move-down"
              :disabled="position < 0 || position >= siblings.length - 1"
              @click="moveBy(1)"
            >
              Move down
            </button>
          </div>
        </div>
        <template v-for="section in sections" :key="section.group ?? ''">
          <section
            v-if="section.group"
            class="space-y-3 border-t border-slate-200 pt-3"
            :aria-label="section.group"
            :data-testid="`inspector-section-${section.group}`"
          >
            <h3 class="text-sm font-semibold text-slate-800">{{ section.group }}</h3>
            <InputField
              v-for="input in section.inputs"
              :key="`${instance.id}:${input.name}`"
              :def="input"
              :value="instance.inputs[input.name]"
              :references="input.type === 'reference' ? references(input.accepts) : undefined"
              :theme-vars="input.control === 'illustration-gallery' ? themeVars : undefined"
              @change="change(input.name, $event)"
            />
          </section>
          <template v-else>
            <InputField
              v-for="input in section.inputs"
              :key="`${instance.id}:${input.name}`"
              :def="input"
              :value="instance.inputs[input.name]"
              :references="input.type === 'reference' ? references(input.accepts) : undefined"
              :theme-vars="input.control === 'illustration-gallery' ? themeVars : undefined"
              @change="change(input.name, $event)"
            />
            <ThemePresets v-if="isTheme" :inputs="instance.inputs" @pick="store.applyThemePreset(instance.id, $event)" />
          </template>
        </template>

        <section v-if="users.length > 0 || isTheme" class="space-y-2 border-t border-slate-200 pt-3" aria-labelledby="used-by-heading" data-testid="used-by">
          <h3 id="used-by-heading" class="text-sm font-semibold text-slate-800">Used by</h3>
          <ul v-if="users.length > 0" class="space-y-1">
            <li v-for="user in users" :key="user.id">
              <button
                type="button"
                class="flex w-full items-baseline justify-between gap-2 rounded-md bg-slate-100 px-2 py-1 text-left text-sm hover:bg-slate-200"
                :data-used-by="user.id"
                @click="store.select(user.id)"
              >
                <span class="truncate">{{ user.name }}</span>
                <span class="shrink-0 text-xs text-slate-500">{{ user.type }} #{{ user.id }}</span>
              </button>
            </li>
          </ul>
          <template v-if="isTheme">
            <p v-if="users.length > 0" class="text-xs text-slate-500">Changing a setting restyles every page listed.</p>
            <template v-else>
              <p class="text-sm text-slate-600">No page uses this theme yet.</p>
              <p v-if="unthemedPages.length === 0" class="text-xs text-slate-500">Every page uses another theme; choose this one in a page's Theme setting.</p>
              <button
                v-else
                type="button"
                class="rounded-md border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50"
                data-testid="use-theme"
                @click="store.useThemeOnPages(instance.id)"
              >
                Use on all pages without a theme
              </button>
            </template>
          </template>
        </section>
      </template>
    </div>
  </section>
</template>
