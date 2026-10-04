# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A prototype **feature-based application generator** (2014–2016). Users build a web page in the browser by dragging "Features" (Page, Text, Image, Container, Table, Form, Google Map, Swagger data resource, etc.) from a palette, editing their inputs, and watching the page regenerate live. The saved artifact is an **application model**: JSON listing feature instances and their inputs. The Ruby server is a thin CRUD/persistence layer. Nearly all the logic is client-side CoffeeScript on AngularJS 1.x. See `README.md` for the concepts (Feature, inputs, generate, application metadata) and `doc/AppArchitecture.jpg`.

## Project status

Dormant since Dec 2016 and **does not build on a current toolchain**. The goal is to modernize it. Findings from Oct 2026 (Ruby 3.3.6, macOS arm64):

- `Gemfile` pins `ruby '2.2.4'`, so `bundle install` refuses to run.
- With the pin removed, `Gemfile.lock` still fails: native gems puma 2.11, eventmachine 1.0.7, json 1.8.2 and libv8/therubyracer don't compile.
- With the lockfile also dropped (fresh resolve, therubyracer removed so ExecJS uses Node), gems install but the app **won't load**: `sinatra-assetpack` (abandoned, last release 2015) registers regex routes that Mustermann (Sinatra 2+) rejects (`regular expression should not contain ^`). **sinatra-assetpack is the main blocker.** It does CoffeeScript compilation, concatenation and minification, so replacing it means picking a new asset pipeline.
- No Redis server is installed locally. Specs use `fakeredis`, so Redis isn't needed for tests.
- Some specs probably fail even on the original stack: `spec/app_spec.rb` expects PUT to return 200 (app returns 204) and POST to echo the whole model (app returns only `{id}`).

**Dead external services** used by features and sample models: Yahoo YQL (`query.yahooapis.com`, shut down 2019), Google Image Charts (`chart.googleapis.com`, retired), IBM Bluemix (`*.mybluemix.net`), Watson TTS beta (`stream.watsonplatform.net`), keyless Google Static Maps. Expect those features to break at runtime.

**Vendored front-end libs** (committed in `app/js/vendor/`, not package-managed): jQuery 2.1.1, jQuery UI, AngularJS 1.3.13 (EOL), Bootstrap 3.2.0, d3 3.5.5, underscore, tree-model, plus angular drag-drop/sortable/colorpicker plugins.

## Modernization goals

The purpose of the project is to **showcase parametric, feature-based modeling** (in the spirit of CAD feature trees) applied to app generation. Preserve that model and don't swap in a generic page-builder library.

- **Frontend:** Vue 3 + TypeScript + Vite (Pinia for state). CoffeeScript and AngularJS 1.x will be removed.
- **Engine:** keep the separation between generation and rendering. Features should be pure `generate(inputs, context)` functions that output a document tree plus metadata, and Vue renders that tree. No direct DOM mutation from features. Replace the retry loop with dependency-ordered (topological) regeneration.
- **Styling:** two separate concerns.
  - Editor UI uses Tailwind CSS + shadcn-vue (Reka UI), replacing Bootstrap 3, jQuery UI and the colorpicker plugin.
  - Generated pages do **not** use Tailwind classes. Tailwind only generates classes it finds at build time, and feature style inputs (colors, widths) are runtime parameters. Node components apply inputs as inline styles or CSS custom properties, with component-scoped CSS per node kind. Container layouts use CSS Grid.
  - A Theme feature exposes global style parameters as CSS variables on the page root.
  - The standalone preview renders without editor styles.
  - The model migration maps Bootstrap class values in inputs (`center-block`, `pull-left`) to plain values.
- **Backend:** Cloudflare Workers (Hono) serving the Vue build plus `/api/v1/models`. Storage is leaning toward D1; not yet decided. Put persistence behind a small `ModelStore` interface (`list/get/create/update/delete`) so the backing store can change in one file.
- **Local dev:** `wrangler dev` with local D1. Wrangler stores data as SQLite files in `.wrangler/state/` (gitignore it; delete it to reset), so local and production use the same code and storage API. No Docker or Redis: Cloudflare has no managed Redis, and a separate dev store would drift from production. Seed local data from `app_models/*.json`.
- **Tests:** the engine is pure TypeScript, so its tests (Vitest) load `app_models/*.json` directly from disk as fixtures and need no storage layer.

## New stack (in progress)

An npm workspace (`package.json` at the root, packages under `packages/`). Node LTS. CI (`.github/workflows/ci.yml`) runs typecheck and tests on every push and PR. **Everything new must be covered by tests.**

```bash
npm install
npm test                    # all workspaces (Vitest)
npm run typecheck           # tsc --noEmit, all workspaces
npm run build               # emit packages/engine/dist (JS + .d.ts)
npm run smoke               # build, then import the engine by package name from plain Node
cd packages/engine && npx vitest run test/generate.test.ts -t "cycle"   # one file / one test
cd packages/engine && npx vitest           # watch mode
```

### `packages/engine`: the parametric generation engine (pure TypeScript, no DOM, no platform globals)
- **v2 model** (`src/types.ts`): `{ version: 2, name, features: FeatureInstance[] }`.
  - Each instance has `feature`, `id`, `inputs` (plain values: strings, numbers, booleans, string lists) and, when placed, `placement: { parent, slot }`.
  - `parent` is the parent's **instance id**, or `$root` for the document. `slot` is a local key: `content` (root and Page), `r1c2` (Container cell), `body` (Panel). Renaming a feature never breaks placement.
  - References between features (e.g. Table -> DataResource) are `reference`-type inputs holding an instance id.
- **`migrate(legacy)`** (`src/migrate/`) is the only code that knows the legacy format. It converts it to v2 and returns `{ model, notes }`.
  - It maps legacy DOM-id targets (`#container_my_container_12_row_1_col_2`) to `{ parent, slot }` and resolves name-based data resource references to instance ids.
  - Values become **what the legacy app rendered**:
    - `disable` only counted when it was boolean `true`.
    - Other booleans used JS truthiness, so `"false"` meant on.
    - Containers with no valid rows or columns get the 1x2 default.
    - Bootstrap values (`text-center`, `pull-left`, `panel-success`) map to plain values.
  - Every interpretation is recorded as a note, and text using HTML or `{{...}}` bindings is flagged.
  - Unported feature types keep their scalar inputs and their legacy instance in `cache.legacy`, so they can be migrated properly once ported.
  - v2 models pass through unchanged.
- **`generate(model, registry?)`** (`src/generate.ts`) returns `{ root, metadata, graph, edgeKinds, order, diagnostics }`.
  - The graph has `placement` edges (parent -> child) and `reference` edges (referenced -> referencing).
  - Features generate in topological order. Siblings attach to their slot in **model order**.
  - Suppression (`disable`) and skipping propagate along both edge kinds.
  - Never throws: unknown feature, missing or unresolved placement or reference, missing slot or node, duplicate ids, cycles, out-of-order (a feature listed before something it depends on), and exceptions thrown by a feature all become `diagnostics`.
  - Never mutates the model or feature output.
- **Feature API** (`src/feature.ts`): implement `FeatureDefinition`.
  - Declare `inputs` (with defaults for new instances; `resolveInputs` fills absent ones) and `placement: 'required' | 'none'`.
  - Optionally declare `slots(inputs)` (slot keys; mark the matching nodes with `slot`) and `dependencies(inputs)` (ids beyond `reference` inputs).
  - `generate(inputs, ctx)` returns `{ node?, exports? }`.
  - The context provides `ctx.nodeId(part?)` for node ids (`12`, `12.r1c2`), `ctx.resolve(id)` (only declared dependencies; returns their frozen `exports`) and `ctx.report(severity, message)`.
- **Node kinds** are typed: `NodeKinds` in `src/types.ts` maps each `kind` to its props. Extend it with declaration merging.
- **Features** live in `src/features/`, one file each, registered in `src/features/index.ts`. Ported so far: Page, Container, Panel, Text, Header, Image, DataResource, Table. **To add a feature:**
  - Implement it and register it.
  - Add an input migration in `src/migrate/index.ts` if legacy models use it.
  - Add tests: the contract tests in `test/features.test.ts` run automatically for every registered feature.
- **Golden tests:** `test/fixtures.test.ts` migrates `sample.json` and every `app_models/*.json`, then snapshots the v2 model summary, migration notes, document outline and diagnostics. Snapshot diffs are the review record. Read them before running `vitest -u`.
- **Packaging:** source uses `.js` import specifiers so `tsc -p tsconfig.build.json` emits runnable ESM to `dist/`. `exports` has a `source` condition (TS source, for Vite/Vitest via `resolve.conditions` / `customConditions`) and a `default` condition (built `dist/`). `npm run smoke` proves plain Node can import it.

## Commands (original stack; won't work until dependencies are modernized)

```bash
bundle install
rake app:run            # rackup on :4567 (needs local Redis on localhost:6379)
bundle exec rspec       # Ruby specs (fakeredis, no Redis needed)
bundle exec rspec spec/lib/model_access_spec.rb:12   # single example
rake specs:ci           # Jasmine JS specs headless (assetpack:build → public/, then jasmine:ci via PhantomJS)
rake specs:server       # Jasmine specs in a browser
rake assets:clean       # delete generated public/
```

Deployment targets were Heroku (`Procfile`: puma) and Cloud Foundry/Bluemix (`manifest.yml`, bound to a `redis-db1` service).

## Architecture

### Server (Ruby/Sinatra)
- `config.ru` → `app.rb` (`App < Sinatra::Base`, modular style). `load_path.rb` puts `lib/` and the repo root on `$LOAD_PATH`.
- `app.rb` declares the asset bundles (sinatra-assetpack serves `app/js`, `app/css` and `app/images`, and compiles `.coffee` on the fly). **The JS bundle order matters**: vendor libs, then `application.js`, then `/js/*.js` alphabetically.
- Routes:
  - `GET /`, `GET /models/:id`: designer UI (`views/layout.slim` + `views/index.slim`, `designMode = true`).
  - `GET /models/:id/preview`: rendered app only (`views/content.slim`, no layout, `designMode = false`).
  - `/api/v1/models[/:id]`: REST CRUD on application models. GET on a missing id returns **410**, not 404. If the store is empty, `GET /api/v1/models` seeds it from `sample.json`.
  - `/api/app_features`: legacy endpoint that reads and overwrites `sample.json` on disk.
- `lib/model_access.rb`: models are stored as JSON strings in one Redis hash (`content_models`), keyed by UUID. The Redis client is created at class-load time (`Client` constant).
- `lib/redis_connection.rb`: reads credentials from `VCAP_SERVICES` (Cloud Foundry) with a fallback to `localhost:6379`.

### Client (CoffeeScript + AngularJS 1.3, `app/js/`)
- `application.coffee`: Angular module `sampleDomainApp`.
- `features.coffee` (~2000 lines, the core): `BaseFeature` plus ~20 `*Feature` classes, registered in the `FeatureClasses` map at the bottom. Each feature declares `name`, `icon`, an `inputs` schema (each input's `control` names a form directive in `form_directives.coffee`), optionally `visual_editor`, and a `generate(appMetadata, instance, inputs)` function. That function **mutates the DOM directly with jQuery** (appends into its target container) and returns `false` if its target doesn't exist yet. **To add a feature**: add a class and register it in `FeatureClasses`.
- `generator.coffee` (`AppGenerate`): runs every non-disabled feature instance in order and retries features that returned `false` (up to ~4 passes) so children can render after their containers. `generateInstance` does partial regeneration of one feature plus its dependents.
- `metadata.coffee` (`AppMetadata`): transient tree (tree-model.js) rebuilt on every generate. It records Pages → Targets, Features, DataResources (+ Operations), DataSchemas and feature dependencies. Features use it to discover each other, and editors use it to populate selectors (e.g. page targets, resources).
- `app_features.coffee` (`AppFeatures`): the loaded model's feature-instance list (add/move/delete/save via `$resource`).
- `controllers.coffee` (`ModelCtrl` load/save/saveAs/delete/preview, `FeaturesCtrl` drag-drop), `directives.coffee` (palette, feature list, editor, `generatedContent`, metadata view), `runtime.coffee` (`DataResource` service plus `serviceResource`/`googleChart` directives used by generated pages), `visual_editors.coffee` (inline contenteditable editing).
- Components communicate mostly through `$rootScope.$broadcast` events: `generateContent`, `featureSelected`, `featureUpdated`, `addFeature`, `moveFeature`, `postGenerate`, `deleteResource`, `postResource`.
- Generated HTML is `$compile`d by Angular after generation, so features can emit Angular directives in their markup.

### Data
- `sample.json`: seed feature list. `app_models/*.json`: example application models (Google Map, Swagger, Watson, "Buy Deal").
- Feature instance shape: `{feature: "TextFeature", id: "27", inputs: {..., page_location: {name, target}}, cache: {}}`. `page_location.target` is a CSS selector (`#content_section`, `#page_container`, or a container cell id), which is how nesting works.

## Gotchas
- Instance ids are stringified integers (`AppFeatures.nextIndex`). DOM ids are derived as `<name>_<id>`, lowercased, with spaces replaced by underscores (`BaseFeature.instanceId`).
- Several inputs misspell `default` as `defaut` (e.g. the `disable` input), so they default to `''`. Specs depend on that behavior.
- `ScriptTestFeature` `eval`s a script built from user input. Persisted models can contain Angular `$$hashKey` fields.
- `rake package:build` just zips `app/`.
