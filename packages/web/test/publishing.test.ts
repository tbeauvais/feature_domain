import { MemoryModelStore, MemoryRowStore, ModelConflictError, type AppModel } from '@feature-domain/engine'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import PublishDialog from '../src/editor/PublishDialog.vue'
import { setModelStore, setPublishing } from '../src/services'
import { ApiError, ApiModelStore } from '../src/stores/apiModelStore'
import { useDocumentStore } from '../src/stores/document'
import { CHANGED_DELAY_MS, usePublicationStore } from '../src/stores/publication'
import { inst, model, page } from './helpers'
import { workerApp } from './workerApp'

// Publishing from the editor, against the Worker's real routes in this process.

const requests = (inputs = {}) =>
  inst('DatabaseTableFeature', '2', { name: 'Requests', fields: ['title: text', 'due: date'], sample_rows: '[]', ...inputs }, null)

let models: MemoryModelStore
let api: ApiModelStore
beforeEach(async () => {
  setActivePinia(createPinia())
  models = new MemoryModelStore()
  const app = await workerApp(models, undefined, new MemoryRowStore())
  // The test environment's Request refuses keepalive, which only matters to browsers.
  api = new ApiModelStore(((url: string, init?: RequestInit) => app.request(url, { ...init, keepalive: undefined })) as unknown as typeof fetch)
  setModelStore(api)
  setPublishing(api)
})

describe('ApiModelStore publishing', () => {
  it('reads a publication, publishes a revision, and unpublishes', async () => {
    expect(await api.publication('missing')).toBeNull()
    const id = await api.create(model(page(), requests()))
    expect(await api.publication(id)).toEqual({ published: null, urlTemplate: 'http://{slug}.localhost/', latest: null, liveRows: {} })
    const published = await api.publish(id, 1, { slug: 'requests' })
    expect(published).toEqual({ slug: 'requests', url: 'http://requests.localhost/', version: 1, publishedAt: expect.any(String) })
    expect(await api.publication(id)).toMatchObject({ published, latest: { version: 1, model: { name: 'test' } }, liveRows: { '2': 0 } })
    await api.update(id, { ...model(page(), requests()), name: 'Changed' })
    await expect(api.publish(id, 1, {})).rejects.toBeInstanceOf(ModelConflictError)
    await api.unpublish(id)
    expect(await api.publication(id)).toMatchObject({ published: null, latest: { version: 1 } })
  })

  it('lists versions, reads one, and publishes an earlier one again', async () => {
    const id = await api.create(model(page(), requests()))
    await api.publish(id, 1, { slug: 'requests' })
    await api.update(id, { ...model(page(), requests()), name: 'Changed' })
    await api.publish(id, 2, {})
    expect(await api.versions(id)).toEqual([
      { version: 2, publishedAt: expect.any(String), name: 'Changed' },
      { version: 1, publishedAt: expect.any(String), name: 'test' },
    ])
    expect(await api.version(id, 1)).toMatchObject({ name: 'test' })
    expect(await api.version(id, 7)).toBeNull()
    expect(await api.republish(id, 1, {})).toMatchObject({ slug: 'requests', version: 3 })
    expect((await api.publication(id))?.latest?.model.name).toBe('test')
  })

  it("keeps the Worker's problems with its refusals", async () => {
    const first = await api.create(model(page()))
    const second = await api.create(model(page()))
    await api.publish(first, 1, { slug: 'requests' })
    const refused = await api.publish(second, 1, { slug: 'requests' }).catch((e: unknown) => e)
    expect(refused).toBeInstanceOf(ApiError)
    expect(refused).toMatchObject({ status: 409, message: 'Another app has this address', problems: ['"requests" is taken: choose another address name'] })
  })
})

describe('usePublicationStore', () => {
  async function open(m: AppModel) {
    const id = await models.create(m)
    const document = useDocumentStore()
    document.editing = true
    await document.load(id)
    const publication = usePublicationStore()
    await publication.load(id)
    return { id, document, publication }
  }

  it('saves the draft before publishing it, and says when the draft differs from what is live', async () => {
    const { document, publication } = await open(model(page(), requests()))
    expect(publication.changed).toBe(false)
    expect(await publication.publish({ slug: 'requests' })).toMatchObject({ version: 1 })
    expect(publication.info?.published?.version).toBe(1)
    expect(publication.changed).toBe(false)
    // An edit not saved yet is saved, then published.
    document.rename('Office requests')
    expect(publication.changed).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, CHANGED_DELAY_MS + 50))
    expect(publication.changed).toBe(true)
    expect(await publication.publish({})).toMatchObject({ version: 2 })
    expect(publication.info?.latest?.model.name).toBe('Office requests')
    expect(publication.changed).toBe(false)
  })

  it("never gives a removed table's id to a new one, even past an undo, so it never gets the app's rows", async () => {
    const { document, publication } = await open(model(page(), requests()))
    await publication.publish({ slug: 'requests' })
    document.remove('2')
    expect(document.add('DatabaseTableFeature')).toBe('3')
    document.undo()
    expect(document.add('DatabaseTableFeature')).toBe('4')
  })
})

describe('reading the publication', () => {
  it('counts only the newest read, so a slow earlier one never undoes it', async () => {
    const id = await models.create(model(page(), requests()))
    const document = useDocumentStore()
    document.editing = true
    await document.load(id)
    let release!: () => void
    const slow = new Promise<void>((resolve) => (release = resolve))
    const read = api.publication.bind(api)
    let first = true
    setPublishing({
      ...{ versions: api.versions.bind(api), version: api.version.bind(api), republish: api.republish.bind(api) },
      publication: async (m) => {
        const answer = await read(m)
        if (first) {
          first = false
          await slow
        }
        return answer
      },
      publish: api.publish.bind(api),
      unpublish: api.unpublish.bind(api),
    })
    const publication = usePublicationStore()
    const stale = publication.load(id)
    await publication.publish({ slug: 'requests' })
    expect(publication.info?.published?.version).toBe(1)
    release()
    await stale
    expect(publication.info?.published?.version).toBe(1)
  })
})

describe('ids a new feature never takes', () => {
  it("passes over a published app's ids in a model from before lastId", async () => {
    // Published with table 2, which the draft then lost in a session before models remembered their ids.
    const id = await models.create(model(page(), requests()))
    await api.publish(id, 1, { slug: 'requests' })
    await models.update(id, model(page()))
    const document = useDocumentStore()
    document.editing = true
    await document.load(id)
    await usePublicationStore().load(id)
    expect(document.add('DatabaseTableFeature')).toBe('3')
  })

  it("keeps the published app's ids through Load their version", async () => {
    const id = await models.create(model(page(), requests()))
    await api.publish(id, 1, { slug: 'requests' })
    await models.update(id, model(page()))
    const document = useDocumentStore()
    document.editing = true
    await document.load(id)
    await usePublicationStore().load(id)
    await document.loadTheirs()
    expect(document.add('DatabaseTableFeature')).toBe('3')
  })

  it('keeps those given out here when a save from elsewhere arrives', async () => {
    const id = await models.create(model(page()))
    const document = useDocumentStore()
    document.editing = true
    await document.load(id)
    expect(document.add('DatabaseTableFeature')).toBe('2')
    document.undo()
    await document.flush()
    // Another tab saves a model that never had table 2.
    const stored = (await models.get(id))!
    await models.update(id, { ...stored.model, name: 'Elsewhere', lastId: undefined })
    expect(await document.refresh()).toBe(true)
    expect(document.model?.name).toBe('Elsewhere')
    expect(document.add('DatabaseTableFeature')).toBe('3')
  })
})

describe('PublishDialog', () => {
  it('never chooses a version still being read when the dialog opened again', async () => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.open = true
    }
    const id = await models.create(model(page(), requests()))
    await api.publish(id, 1, { slug: 'requests' })
    await models.update(id, { ...model(page(), requests()), name: 'Changed' })
    await api.publish(id, 2, {})
    const document = useDocumentStore()
    document.editing = true
    await document.load(id)
    const w = mount(PublishDialog, { attachTo: window.document.body })
    const vm = w.vm as unknown as { open(): Promise<void> }
    await vm.open()
    await flushPromises()
    await w.get('button[aria-label="Publish version 1 again"]').trigger('click')
    await vm.open()
    await flushPromises()
    expect(w.find('[data-testid="publish-source"]').exists()).toBe(false)
    expect(w.text()).toContain('Publish version 3')
    expect(w.get('button[aria-label="Publish version 1 again"]').attributes('disabled')).toBeUndefined()
    w.unmount()
  })

  it('waits for a version being read before publishing, and lets the draft win over a read still going', async () => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.open = true
    }
    const id = await models.create(model(page(), requests()))
    await api.publish(id, 1, { slug: 'requests' })
    await models.update(id, { ...model(page(), requests()), name: 'Changed' })
    await api.publish(id, 2, {})
    await models.update(id, { ...model(page(), requests()), name: 'Third' })
    await api.publish(id, 3, {})
    await models.update(id, { ...model(page(), requests()), name: 'Draft' })
    // Version reads held until the test lets each go.
    const held: (() => void)[] = []
    setPublishing({
      publication: api.publication.bind(api),
      publish: api.publish.bind(api),
      unpublish: api.unpublish.bind(api),
      versions: api.versions.bind(api),
      republish: api.republish.bind(api),
      version: async (m, n) => {
        await new Promise<void>((resolve) => held.push(resolve))
        return api.version(m, n)
      },
    })
    const document = useDocumentStore()
    document.editing = true
    await document.load(id)
    const w = mount(PublishDialog, { attachTo: window.document.body })
    await (w.vm as unknown as { open(): Promise<void> }).open()
    await flushPromises()
    const publishButton = () => w.findAll('button').find((b) => /^Publish (version|the|$)/.test(b.text()) && b.text() !== 'Publish the draft instead')!
    expect(publishButton().attributes('disabled')).toBeUndefined()

    // While version 1 is read, Publish waits.
    await w.get('button[aria-label="Publish version 1 again"]').trigger('click')
    expect(w.text()).toContain('Reading…')
    expect(publishButton().attributes('disabled')).toBeDefined()
    held.shift()!()
    await flushPromises()
    expect(w.get('[data-testid="publish-source"]').text()).toContain('Publishing version 1')

    // Back to the draft while another read is going: the draft stays chosen when it lands.
    await w.get('button[aria-label="Publish version 2 again"]').trigger('click')
    await w
      .findAll('button')
      .find((b) => b.text() === 'Publish the draft instead')!
      .trigger('click')
    held.shift()!()
    await flushPromises()
    expect(w.find('[data-testid="publish-source"]').exists()).toBe(false)
    expect(publishButton().text()).toBe('Publish version 4')
    expect(publishButton().attributes('disabled')).toBeUndefined()
    w.unmount()
  })

  it('says when the model no longer exists', async () => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.open = true
    }
    const id = await models.create(model(page()))
    const document = useDocumentStore()
    document.editing = true
    await document.load(id)
    await models.delete(id)
    const w = mount(PublishDialog, { attachTo: window.document.body })
    await (w.vm as unknown as { open(): Promise<void> }).open()
    await flushPromises()
    expect(w.get('[role="alert"]').text()).toBe('This model no longer exists, so it can’t be published.')
    w.unmount()
  })

  beforeEach(() => {
    // jsdom has no modal dialogs.
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.open = true
    }
  })

  it('says what a publish changes for the app, what only works in the builder, and what to fix first', async () => {
    const id = await models.create(model(page(), requests()))
    await api.publish(id, 1, { slug: 'requests' })
    await models.update(
      id,
      model(
        page(),
        requests({ fields: ['title: text, required', 'due: yes/no'] }),
        inst('LinkFeature', '3', { name: 'Back', text: 'Back', href: '/models/7' }),
        inst('TableFeature', '4', { name: 'Broken', data_resource: '9' }),
      ),
    )
    const document = useDocumentStore()
    document.editing = true
    await document.load(id)
    const w = mount(PublishDialog, { attachTo: window.document.body })
    await (w.vm as unknown as { open(): Promise<void> }).open()
    await flushPromises()
    const text = w.text()
    expect(text).toContain('Version 1 is live at http://requests.localhost/')
    expect((w.get('#publish-slug').element as HTMLInputElement).value).toBe('requests')
    expect(text).toContain('“Requests”: “title” becomes required.')
    expect(text).toContain('“Requests”: “due” changes from date to yes/no.')
    expect(text).toContain('Back links to /models/7, which shows the app again on the app’s address.')
    expect(text).toContain('Fix these first')
    expect(w.get('button:not([type="submit"]):last-of-type').attributes('disabled')).toBeDefined()
    // A new address name moves the app, with no redirect.
    await w.get('#publish-slug').setValue('team-requests')
    await w.get('#publish-slug').trigger('input')
    expect(w.text()).toContain('The old one stops working, with no redirect.')
    w.unmount()
  })
})
