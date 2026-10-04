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
cd packages/engine && npx vitest run test/generate.test.ts -t "cycle"   # one file / one test
cd packages/engine && npx vitest           # watch mode
```

### `packages/engine`: the parametric generation engine (pure TypeScript, no DOM)
- `generate(model, registry?)` in `src/generate.ts` produces `{ root, metadata, graph, order, diagnostics }`. Steps:
  1. Each feature's `slots()` declares the target ids it provides.
  2. `page_location.target` links each feature to its parent, which gives the dependency graph.
  3. Features generate in topological order (`src/graph.ts`). Each `generate()` returns a `DocNode` tree.
  4. Nodes are attached to their parent slots in **model order**.
- Problems never throw. They become `diagnostics`: unknown feature, unresolved or duplicate target, cycle, suppressed (`disable`), and so on. Suppressing a feature suppresses everything placed inside it.
- `dependentsOf(graph, id)` gives the set of features to regenerate when one changes (for incremental regeneration later).
- Features live in `src/features/`, one file each, registered in `src/features/index.ts`. Ported so far: Page, Container, Text, Header, Image. **To add a feature:**
  - Implement `FeatureDefinition` with `inputs`, an optional `slots`, and a pure `generate`.
  - Register it.
  - Add tests in `test/features.test.ts`. The contract tests run automatically for every registered feature.
- **Defaults vs absent inputs:** `InputDef.default` applies only to new instances (`createFeatureInstance`). `generate` reads stored inputs as-is, and an absent input keeps its legacy meaning (no well, no tone, left-aligned). Legacy Bootstrap values (`text-center`, `pull-left`, `text-info`) are mapped in `src/features/legacy.ts`.
- Target and DOM ids match the legacy app (`instanceDomId`: `my_container_12`; container cells: `container_my_container_12_row_1_col_1`) so existing models resolve unchanged.
- **Golden tests:** `test/fixtures.test.ts` generates `sample.json` and every `app_models/*.json` and snapshots an outline of each document and its diagnostics. Snapshot diffs are the review record of output changes. Read them before running `vitest -u`.

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
