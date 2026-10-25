<script setup lang="ts">
import {
  builderAddresses,
  builderAddressText,
  databaseTableKeys,
  databaseTables,
  diffSchemas,
  featureName,
  ModelConflictError,
  schemaChangeText,
  slugProblem,
  suggestSlug,
  type AppModel,
} from '@feature-domain/engine'
import { computed, ref } from 'vue'
import { ApiError, type Publication } from '../stores/apiModelStore'
import { useDocumentStore } from '../stores/document'
import { usePublicationStore } from '../stores/publication'

/**
 * Publishes the draft as the app's next version, at <slug>.<app domain>: the address, what the publish does to the
 * app's stored rows (tables it removes are confirmed one by one, with their row counts), what only works in the
 * builder, and on a first publish whether the app starts with the draft's rows. A native <dialog>, like the shortcuts.
 */
const document = useDocumentStore()
const publication = usePublicationStore()

const dialog = ref<HTMLDialogElement | null>(null)
const slug = ref('')
const copyDraftRows = ref(false)
const confirmed = ref(new Set<string>())
const busy = ref(false)
const failure = ref<{ message: string; problems: string[] } | null>(null)
const done = ref<Publication | null>(null)
const askingUnpublish = ref(false)
/** Whether the dialog is open: what it works out (generating the draft and the newest version) waits for it. */
const shown = ref(false)
/** The address name was typed, so reading the publication again doesn't replace it. */
const slugTyped = ref(false)

const info = computed(() => publication.info)
const draft = computed(() => document.model)
const published = computed(() => info.value?.published ?? null)
const latest = computed(() => info.value?.latest ?? null)

const problem = computed(() => slugProblem(slug.value))
const address = computed(() => info.value?.urlTemplate.replace('{slug}', slug.value) ?? '')
const renaming = computed(() => !!published.value && slug.value !== published.value.slug)

/** A feature's name in a model, else its id (as the Worker names it). */
const nameIn = (model: AppModel, id: string) => featureName(model, id) ?? id

/**
 * Tables a publish deletes the app's rows of, as the Worker works them out: each one it counts (the newest version's,
 * and any other it keeps rows in) that the draft no longer holds.
 */
const removedTables = computed(() => {
  if (!ready.value || !latest.value) return []
  const kept = new Set(databaseTableKeys(draft.value!))
  return Object.entries(info.value!.liveRows)
    .filter(([key]) => !kept.has(key))
    .map(([key, rows]) => ({ key, name: nameIn(latest.value!.model, key), rows }))
})
/** The newest version's tables, worked out once per reading of the publication. */
const latestTables = computed(() => (shown.value && latest.value ? databaseTables(latest.value.model) : undefined))
const otherChanges = computed(() =>
  ready.value && latestTables.value
    ? diffSchemas(latestTables.value, draft.value!)
        .filter((c) => c.kind !== 'removed-table')
        .map((c) => schemaChangeText(c, nameIn(draft.value!, c.table)))
    : [],
)
const builderOnly = computed(() => (ready.value ? builderAddresses(draft.value!).map((a) => builderAddressText(a, nameIn(draft.value!, a.feature))) : []))

/** The draft's errors, which the Worker refuses to publish: said here first. */
const errors = computed(() =>
  shown.value ? [...new Set((document.result?.diagnostics ?? []).filter((d) => d.severity === 'error').map((d) => d.message))] : [],
)

const ready = computed(() => shown.value && publication.status === 'ready' && !!info.value && !!draft.value)
const canPublish = computed(
  () => ready.value && !problem.value && !busy.value && errors.value.length === 0 && removedTables.value.every((t) => confirmed.value.has(t.key)),
)

function toggle(key: string, on: boolean) {
  const next = new Set(confirmed.value)
  if (on) next.add(key)
  else next.delete(key)
  confirmed.value = next
}

const defaultSlug = () => publication.info?.published?.slug ?? suggestSlug(document.model?.name ?? '')

async function refresh() {
  if (document.modelId) await publication.load(document.modelId)
  if (!slugTyped.value) slug.value = defaultSlug()
}

async function open() {
  failure.value = null
  done.value = null
  askingUnpublish.value = false
  copyDraftRows.value = false
  confirmed.value = new Set()
  slugTyped.value = false
  slug.value = defaultSlug()
  shown.value = true
  if (dialog.value && !dialog.value.open) dialog.value.showModal()
  await refresh()
}

function failed(e: unknown) {
  if (e instanceof ModelConflictError)
    failure.value = { message: 'The model was changed elsewhere since it was saved here. Load their version, then publish again.', problems: [] }
  else if (e instanceof ApiError) failure.value = { message: e.message, problems: e.problems }
  else failure.value = { message: e instanceof Error ? e.message : String(e), problems: [] }
}

async function publish() {
  if (!canPublish.value) return
  busy.value = true
  failure.value = null
  try {
    done.value = await publication.publish({
      slug: slug.value,
      ...(latest.value ? {} : { copyDraftRows: copyDraftRows.value }),
      removeTables: removedTables.value.map((t) => t.key),
    })
  } catch (e) {
    failed(e)
  } finally {
    busy.value = false
  }
}

async function unpublish() {
  busy.value = true
  failure.value = null
  try {
    await publication.unpublish()
    askingUnpublish.value = false
  } catch (e) {
    failed(e)
  } finally {
    busy.value = false
  }
}

const date = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

defineExpose({ open, isOpen: () => dialog.value?.open === true })
</script>

<template>
  <dialog
    ref="dialog"
    class="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-xl border border-slate-200 p-0 text-slate-900 shadow-xl backdrop:bg-slate-900/30"
    aria-labelledby="publish-heading"
    data-testid="publish-dialog"
    @close="shown = false"
  >
    <div class="max-h-[85vh] space-y-4 overflow-y-auto p-5 text-sm">
      <h2 id="publish-heading" class="text-base font-semibold">Publish {{ draft?.name }}</h2>

      <template v-if="done">
        <p role="status">
          Published version {{ done.version }} at
          <a :href="done.url" target="_blank" rel="noopener" class="font-medium text-sky-700 underline">{{ done.url }}</a
          >.
        </p>
      </template>

      <p v-else-if="publication.status === 'error'" role="alert" class="text-red-700">
        Couldn’t read where the app is published: {{ publication.error }}
        <button type="button" class="ml-1 underline" @click="refresh">Try again</button>
      </p>
      <p v-else-if="publication.status === 'ready' && !info" role="alert" class="text-red-700">This model no longer exists, so it can’t be published.</p>
      <p v-else-if="!ready">Loading…</p>

      <template v-else>
        <p v-if="published" class="text-slate-600" data-testid="publish-current">
          Version {{ published.version }} is live at
          <a :href="published.url" target="_blank" rel="noopener" class="font-medium text-sky-700 underline">{{ published.url }}</a
          >, published {{ date(published.publishedAt) }}.
        </p>
        <p v-else-if="latest" class="text-slate-600">Not published now. Version {{ latest.version }} was the last one; publishing again counts on.</p>
        <p v-else class="text-slate-600">The app gets an address of its own. Only people the builder lets in can open it.</p>

        <div class="space-y-1">
          <label for="publish-slug" class="block font-medium">Address name</label>
          <input
            id="publish-slug"
            v-model.trim="slug"
            @input="slugTyped = true"
            class="w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono focus:border-sky-500 focus:outline-none"
            :aria-invalid="!!problem"
            aria-describedby="publish-address"
            autocomplete="off"
            spellcheck="false"
          />
          <p id="publish-address" :class="problem ? 'text-red-700' : 'text-slate-600'">
            {{ problem ?? address }}
          </p>
          <p v-if="renaming" class="text-amber-800">The app moves to this address. The old one stops working, with no redirect.</p>
        </div>

        <div v-if="errors.length > 0" class="space-y-1 rounded-md border border-red-200 bg-red-50 p-3 text-red-800">
          <h3 class="font-medium">Fix these first</h3>
          <ul class="list-disc pl-5">
            <li v-for="e in errors" :key="e">{{ e }}</li>
          </ul>
        </div>

        <fieldset v-if="removedTables.length > 0" class="space-y-2 rounded-md border border-red-200 bg-red-50 p-3">
          <legend class="px-1 font-medium text-red-800">Tables the draft removes</legend>
          <label v-for="t in removedTables" :key="t.key" class="flex items-start gap-2">
            <input type="checkbox" class="mt-0.5" :checked="confirmed.has(t.key)" @change="toggle(t.key, ($event.target as HTMLInputElement).checked)" />
            <span>Delete “{{ t.name }}” and the app’s {{ t.rows }} {{ t.rows === 1 ? 'row' : 'rows' }} in it</span>
          </label>
        </fieldset>

        <div v-if="otherChanges.length > 0" class="space-y-1">
          <h3 class="font-medium">Changes to the app’s data</h3>
          <ul class="list-disc space-y-1 pl-5 text-slate-700">
            <li v-for="text in otherChanges" :key="text">{{ text }}</li>
          </ul>
        </div>

        <div v-if="builderOnly.length > 0" class="space-y-1">
          <h3 class="font-medium">Only works in the builder</h3>
          <ul class="list-disc space-y-1 pl-5 text-slate-700">
            <li v-for="text in builderOnly" :key="text">{{ text }}</li>
          </ul>
        </div>

        <label v-if="!latest" class="flex items-start gap-2">
          <input v-model="copyDraftRows" type="checkbox" class="mt-0.5" />
          <span>Start the app with the draft’s rows (else each table starts with its sample rows)</span>
        </label>

        <div v-if="askingUnpublish" class="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3" role="group" aria-label="Unpublish">
          <p>Take the app offline? Its address is freed. Its versions and rows stay for when it is published again.</p>
          <div class="flex gap-2">
            <button
              type="button"
              class="rounded-md bg-red-700 px-3 py-1.5 font-medium text-white hover:bg-red-800 disabled:opacity-50"
              :disabled="busy"
              @click="unpublish"
            >
              Unpublish
            </button>
            <button type="button" class="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50" @click="askingUnpublish = false">
              Keep it
            </button>
          </div>
        </div>
      </template>

      <div v-if="failure" role="alert" class="text-red-700">
        <p>{{ failure.message }}</p>
        <ul v-if="failure.problems.length > 0" class="list-disc pl-5">
          <li v-for="p in failure.problems" :key="p">{{ p }}</li>
        </ul>
      </div>

      <div class="flex flex-wrap items-center justify-end gap-2">
        <button
          v-if="ready && published && !done && !askingUnpublish"
          type="button"
          class="mr-auto rounded-md px-2 py-1.5 text-red-700 hover:bg-red-50"
          @click="askingUnpublish = true"
        >
          Unpublish…
        </button>
        <form method="dialog">
          <button type="submit" class="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50">{{ done ? 'Close' : 'Cancel' }}</button>
        </form>
        <button
          v-if="!done"
          type="button"
          class="rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          :disabled="!canPublish"
          @click="publish"
        >
          {{ busy ? 'Publishing…' : latest ? `Publish version ${latest.version + 1}` : 'Publish' }}
        </button>
      </div>
    </div>
  </dialog>
</template>
