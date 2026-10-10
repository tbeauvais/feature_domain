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

- **Frontend:** Vue 3 + TypeScript + Vite (Pinia for state), in `packages/web`. CoffeeScript and AngularJS 1.x will be removed.
- **Drag and drop:** Pragmatic drag and drop (Atlassian) for both the canvas and the feature tree. Gestures call pure engine edit operations (`insertFeature`, `moveFeature`, `removeFeature`, `canPlace`), so the logic is unit-tested and undo is a stack of models.
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
npm run e2e                 # Playwright end-to-end tests (packages/web; first run: npx playwright install chromium)
npm run dev -w packages/web # editor at http://localhost:5173 (preview page: /preview.html?model=<id>); the first load after adding dependencies may reload once while Vite optimizes them
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
  - **Legacy looks are not carried over.** We don't match the old Bootstrap styling: newly ported features migrate content and placement only, and styling inputs (colours, sizes, Bootstrap style classes) are dropped with a `dropped-style` note so the feature takes our own defaults and the theme (`dropLegacyLooks`).
  - Unported feature types keep their scalar inputs and their legacy instance in `cache.legacy`.
  - **v2 models are upgraded, not re-migrated:** any feature still carrying `cache.legacy` whose type now has an input migration is migrated from it, keeping its placement, with an `upgraded-feature` note. Otherwise the same object is returned. The editor applies this on load and saves the result; the preview upgrades in memory only. So porting a feature also fixes models stored before it was ported.
- **`generate(model, registry?)`** (`src/generate.ts`) returns `{ root, metadata, graph, edgeKinds, order, diagnostics }`.
  - The graph has `placement` edges (parent -> child) and `reference` edges (referenced -> referencing).
  - Features generate in topological order. Siblings attach to their slot in **model order**.
  - Suppression (`disable`) and skipping propagate along both edge kinds. Only features that declare a `disable` input can be disabled; a stray stored `disable` (e.g. on a Theme or Data Resource) is ignored.
  - Never throws: unknown feature, missing or unresolved placement or reference, missing slot or node, invalid or duplicate node ids, cycles, out-of-order (a feature listed before something it depends on), and exceptions thrown by a feature's `generate`, `slots` or `dependencies` all become `diagnostics`.
  - `metadata.targets` lists only slots that were actually generated (valid drop targets).
  - Never mutates the model or feature output.
- **Feature API** (`src/feature.ts`): implement `FeatureDefinition`.
  - Declare `inputs` and `placement: 'required' | 'none'`. An input's `default` is what it means when a stored instance lacks it (`resolveInputs` fills it in), so adding an input never changes existing models; `initial` (optional) is the value for new instances when that differs (`createFeatureInstance` uses `initialInputs`). Example: Image's Source defaults to `link` (older images were links) but new Images start as `illustration`.
  - `showWhen` shows an input in the inspector only while other inputs have given values (`isInputShown`): one condition or a list that must all hold. A condition is `{ input, equals }` (`equals` may list several values) or `{ input, notEquals }`, which also matches unrecognised values, so the inspector shows what generation falls back to.
  - A `reference` input with `soft: true` is a **soft reference**: if the target is missing, the wrong type, suppressed or not generated, the feature still generates (with a warning) and `ctx.resolve` returns undefined, so it can fall back. Soft edges still order generation, but cycle detection ignores them, so a cycle that only closes through a soft reference skips nothing. Diagnostics about a soft target are reported only when the referencing feature actually generates.
  - Optionally declare `slots(inputs)` (slot keys; mark the matching nodes with `slot`) and `dependencies(inputs)` (ids beyond `reference` inputs).
  - `generate(inputs, ctx)` returns `{ node?, exports? }`.
  - The context provides `ctx.nodeId(part?)` for node ids (`12`, `12.r1c2`; the engine rejects ids a feature doesn't own), `ctx.resolve(id)` (only declared dependencies; returns a deep-frozen copy of their `exports`) and `ctx.report(severity, message)`.
- **Editor mode:** `generate(model, registry, { placeholders: true })` adds `placeholder` nodes where placed features produced nothing (unknown types, or skipped by a problem), so the editor can show and select them. Suppressed features get none. `metadata.features` lists unknown features too, with status `unknown`, and every non-generated feature has a `reason`: the first problem found, not later effects. The tree, placeholders and inspector all use it.
- **Edit operations** (`src/edit.ts`): `addFeature`, `insertFeature`, `moveFeature`, `removeFeature` (removes the subtree, clears reference inputs that pointed into it, and reports those broken references), `updateInputs`, `canPlace` (the slot must be generated, the feature placeable, and not inside itself) and `nextInstanceId`. Each returns a new model and is pure. `insertFeature` and `moveFeature` validate targets with `canPlace` (throwing `EditError`). After each edit, `normalizeOrder` keeps dependencies first *without changing the page*: siblings in a slot keep their order, so dependencies are pulled forward. Edits therefore never cause `out-of-order`. A seeded randomized test applies hundreds of random edits, and checks the invariants plus that normalizing any shuffled model leaves the rendered page identical.
- **Higher-level features compose primitive nodes.** Don't add a one-off node kind for a feature: build its output from the shared primitives (`heading`, `paragraph`, `image`, `list`, …) and layout nodes (`stack`, `media`, `card`), using the helpers in `features/blocks.ts` (`title`, `paragraphs`). Child node ids come from `ctx.nodeId(part)`. Styling and safety rules then live in one place. (User-built composite features are a planned phase.)
- **Node kinds** are typed: `NodeKinds` in `src/types.ts` maps each `kind` to its props. Extend it with declaration merging.
- **Features** live in `src/features/`, one file each, registered in `src/features/index.ts`. Ported so far: Theme, Page (colours come from the theme; the migration drops legacy `border_color` / `background_color` with a `dropped-style` note), Container, Panel, Text, Header, Image (Source: a built-in illustration or a link), List, Separator (Style: line, or a wave / dots / ruler divider illustration), Link, Button (our own styles: primary, secondary, soft, link; links and buttons render only http(s) addresses), Text with title and Image with text (legacy TextWithParagraph / ImageWithParagraph: a title over paragraphs split on blank lines, with an optional image), List card (legacy ListGroup: its comma list becomes items, and the last item, which the legacy app showed large, becomes the highlight), DataResource, Table. **To add a feature:**
  - Implement it and register it.
  - Add an input migration in `src/migrate/index.ts` if legacy models use it.
  - Add tests: the contract tests in `test/features.test.ts` run automatically for every registered feature.
- **Illustrations** (`src/illustrations.ts`): the catalogue of built-in illustrations (`banner/*`, `spot/*`, `divider/*`: id, name, default alt text, aspect ratio). The engine knows only names and shapes; the `illustration` node kind carries `{ name, alt, width, align, aspect? }` (empty alt = decorative). Banners take a Height (`BANNER_HEIGHTS`: short 6:1, medium 4:1, tall 16:5) as `aspect`, so the height follows the width. The web renderer draws them.
- **Golden tests:** `test/fixtures.test.ts` migrates `sample.json` and every `app_models/*.json`, then snapshots the v2 model summary, migration notes, document outline and diagnostics. Snapshot diffs are the review record. Read them before running `vitest -u`.
- **Storage:** `ModelStore` (`src/store.ts`) is the persistence interface for the browser store now and the Worker later. `MemoryModelStore` is the reference implementation. Every implementation must pass `test/store-contract.ts` (`describeModelStore`), which `packages/web` also imports.
- **Packaging:** source uses `.js` import specifiers so `tsc -p tsconfig.build.json` emits runnable ESM to `dist/`. `exports` has an `@feature-domain/source` condition (TS source, for Vite/Vitest via `resolve.conditions` / `customConditions`; deliberately not a generic `source`, which other packages also define) and a `default` condition (built `dist/`). `npm run smoke` proves plain Node can import it.

### `packages/web`: the Vue app (Vite, Vue 3, Pinia, vue-router, Tailwind v4)
- **Two pages.** `index.html` (`src/main.ts`) is the editor and uses Tailwind. `preview.html` (`src/preview.ts`) shows only the generated page and has no Tailwind, so it looks like a published site.
- **Rendering.** `src/renderer/` renders a `DocNode` tree. `NodeView` picks a component per node kind from `nodeComponents.ts`, which is typed as a full `Record<NodeKind, Component>`, so a new kind fails the typecheck until it has a component.
- **Model ids in the DOM.** `NodeView` adds `data-node-id`, `data-feature-id`, and on slots `data-slot` / `data-slot-parent`, so selection and drag-drop can map the DOM back to the model.
- **Generated-page styling.** `document.css` is plain CSS driven by the theme. The legacy Bootstrap look is gone.
  - **Themes** (`packages/engine/src/theme/`): `deriveTokens(params)` turns theme settings (accent, band colour, light/dark scheme, font pairing, base size, scale ratio, radius, density, shadow) into `--fd-*` custom properties. Colours are computed in OKLCH with gamut mapping, and `ensureContrast` moves each text colour's lightness until it reaches 4.5:1 against every surface it can sit on. Seeded property tests cover contrast, lightness order and determinism. `clampThemeParams` turns any stored values into valid settings.
  - **Component styles** (`panel`, `table`, `well`) are separate named looks. The element carrying a theme (`[data-fd-scheme]`: the root now, pages later) provides it (`renderer/theme.ts`, provide/inject), and each component puts its choice on its **own** element as `data-fd-<component>`, so a nested theme wins over an outer one. `document.css` has one rule block per option, keyed to the component's own attribute (never an ancestor's). `deriveTokens` also returns `adjustments`: colours it changed for readability, in words, for the editor to show. A web test fails if any option lacks rules, if `document.css` uses a `var(--fd-*)` the engine doesn't emit, or if a font pairing names a web font that isn't bundled. A `band` well re-points the colour tokens to the band set, so content inside stays readable.
  - **Theme feature** (`features/theme.ts`, `placement: 'none'`, no `disable`): its inputs are the theme settings, clamped; it exports `{ params, tokens }` and reports readability adjustments as info. A Page's `theme` input is a **soft reference** to it: the page carries the tokens as `props.theme`, and `PageNode` applies them and provides the theme to the components inside. A page without a theme (or with a missing one) inherits the theme around it. `RootNode` takes the first page's theme, else `DEFAULT_THEME` (Warm Editorial: Newsreader display, Geist body, Geist Mono labels, warm cream, vermilion accent). Pages are full width (side padding keeps content within 1120px), so a themed page paints edge to edge.
  - Adding a Theme from the palette also points every page without a working theme at it (`useThemeOnUnthemedPages`), in the same undo step.
  - **Fonts are self-hosted** via `@fontsource-variable/*` packages (OFL), imported in `DocumentView.vue`. Never load fonts from a CDN: `e2e/network.ts` blocks every non-localhost request and fails the test if a blocked one was a stylesheet, font or script.
  - `.fd-root` is a hard boundary. The root starts from `all: initial`, so nothing is inherited from the editor page, and everything inside is reverted to browser defaults (`all: revert`). Then `document.css` applies its own styles.
  - **Except shapes inside an `<svg>`:** their geometry and paint (`r`, `d`, `fill`, …) are CSS properties set by presentation attributes, so a revert would erase the drawing. `:where(.fd-root *:not(svg *))` gets `all: revert`; SVG internals revert only the box properties editor base styles set on every element (border, outline, box-sizing, margin, padding). The e2e isolation test catches anything else that leaks.
  - **Illustrations** (`renderer/illustrations/`, one SVG component each, mapped in `index.ts` as a full `Record<IllustrationId, Component>`) are our own inline SVG. Every colour is an inline `style="fill: var(--fd-…)"` (presentation attributes can't hold `var()`) or `currentColor` (dividers, so the Separator's colour applies); pattern ids come from `useId()`. Banners are two stacked SVGs, so they suit any height: a background that fills the frame (`slice`) and a drawing that always fits whole (`meet`). Tests check each has no scripts, handlers or external references, uses only tokens the engine emits, and hard-codes no colours. Never load illustration images from other sites.
  - An e2e test renders the preview's document at exactly the editor canvas's width, then compares *every* computed property of every element in the editor and the preview, except a short list of layout-dependent ones, including with leaky utility classes added to the canvas wrapper. It fails if the isolation breaks.
  - **Tailwind utilities have no effect inside `.fd-root`.** Editor overlays (selection outlines, drop indicators, inline editors) must live outside it, positioned from bounding boxes, or use plain CSS.
  - Text is always plain text, never `v-html`. Responsive images get no fixed height (their height follows the width, like Bootstrap's `img-responsive`). URL policies are in `renderer/urls.ts`: links and data fetches are http(s) only; image sources are http(s), relative or `data:image/`.
- **Tables.** Tables fetch rows at runtime (`renderer/rows.ts`, injectable through `FETCH_JSON`; phase 3 routes this via `/api/proxy`). Cells use a small filter language (`renderer/filters.ts`: `uppercase`, `lowercase`, `date`, `dataLink :path`), and links are only ever http(s).
- **Editor** (`src/editor/`, `views/ModelView.vue`): a full-height shell. A top bar (logo link, model name, save state, undo/redo, `?` shortcuts dialog, Preview, delete), three columns, and a status bar (problem and feature counts; its button opens the model-wide Problems panel). Below `lg` the columns stack.
  - **Left: palette and feature tree.** The palette is grouped (`editor/palette.ts`; types it doesn't list go under "More") with inline SVG icons (`FeatureIcon.vue`). The palette folds away (remembered per browser via `editor/prefs.ts`; folded tiles stay in the DOM so drag and drop keeps them). Tree rows collapse (`editor/treeCollapse.ts`, reset when another model loads; selecting something inside opens its rows), pages show the theme they use, and Theme rows show an accent swatch. The palette adds a feature into the selected feature's first slot, else after the selection, else on the first page (`editor/targets.ts`). The tree is built from generation metadata (`editor/featureTree.ts`), not the DOM, so skipped, unknown and suppressed features appear with their reasons. Features that are never placed (data resources, themes) go under "Resources and themes"; placeable features whose placement is missing or broken go under "Not on the page".
  - **Centre: the canvas.** A toolbar switches the canvas between Desktop (fills the space), Tablet (820px) and Phone (390px) widths; Tablet and Phone are fixed, so the canvas scrolls sideways in a small window (`editor/canvasWidth.ts`, remembered per browser). Generated pages size themselves from the document's own width (`.fd-root` is a CSS container; `cqi` units and `@container` rules, never `vw` or `@media`), so the narrow canvas shows exactly what a phone would. Clicking selects the nearest `[data-feature-id]`, and links don't navigate. `SelectionOverlay` outlines the selection from outside `.fd-root`.
  - **Right: the schema-driven inspector** (`InputField` picks a control from each `InputDef`), a Location select limited to slots `canPlace` allows, delete (subtree, after a confirmation listing what goes), and the problem list.
  - **Inputs.** List and number fields keep a local draft while typing. Normalized values (trimmed lines, parsed numbers) go to the model, but they don't overwrite the field until blur. Selects show a disabled "Missing: …" option for values that no longer exist. Inputs whose options are drawn as buttons use `control: 'segmented'` or `'illustration-gallery'` (`IllustrationGallery.vue`: the real drawings, painted with the theme of the page the feature is on, from `editor/themeFor.ts`); they are labelled as a group.
  - **Editing.** All edits go through `useDocumentStore` (`add`, `setInputs`, `moveTo`, `remove`, `rename`), which applies pure engine operations, regenerates with placeholders, and autosaves 400 ms after the last change (flushed on page hide). Saves are tied to the model they started on. Leaving the page after a failed save asks before dropping the changes. The preview tab listens for the `storage` event and calls `refresh()`, which never replaces unsaved local edits.
- **Drag-and-drop** (Pragmatic drag and drop):
  - `editor/dnd.ts` is pure and unit-tested. A drop zone is either an empty slot (append) or a feature (before, after, or "combine" = into its first slot). `evaluateDrop` maps the zone to a `PlacementTarget` and checks it with the engine's `canPlace`, detecting drops that change nothing.
  - `editor/useEditorDnd.ts` registers draggables and drop targets on the canvas (`[data-feature-id]`, `[data-slot]`), the tree (`[data-tree-id]`) and the palette (`[data-palette-type]`), rebuilding them after each regeneration and whenever collapsing or expanding re-creates tree rows (it watches `collapsedRows`). Anything else that re-creates draggable elements without a regeneration must trigger a re-registration too. It has one monitor that applies drops through the store (`moveTo` / `addAt`), so drops are validated and undoable.
  - Drop feedback lives in `editor/dndState.ts`, drawn by `DropIndicator` (canvas overlay, outside `.fd-root`) and `TreeRow`.
  - **Gotcha:** Chrome gives `[draggable]` elements `-webkit-user-drag: element; user-select: none` as presentational hints, which `all: revert` discards. `document.css` restores them inside `.fd-root`, or no drag ever starts.
  - Empty slots get a drop area in the editor only (`main.css`, `.fd-editor-canvas`).
  - Draggability is decided by feature type, so unplaced features can be dragged from the tree onto the page.
  - Before or after a Page (the document root) is offered only when dragging a Page; anything else dropped at a page's edge goes into it.
  - Links and images inside a feature are extra drag handles for that feature.
- **Undo/redo.** The store records history at its single `apply()` point, with the selection. Consecutive edits of the same input (or the model name) within 1 s are one step, capped at 100 steps. Loading and the automatic upgrade are not undoable. Buttons, plus ⌘Z / ⇧⌘Z / Ctrl+Y, except in text-entry fields (selects and checkboxes do use them) and while a confirmation dialog is open. Deleting a model discards any pending save first (`store.discard()`). The inspector's Move up / Move down and Location select are the keyboard alternatives to dragging.
- **UI components.** These are shadcn-vue components (Reka UI) in `src/components/ui/`. They're added with `npx shadcn-vue@latest add <name>` from `packages/web`. The CLI is deliberately not a dependency (it pulled in vulnerable packages); its Tailwind variants are vendored in `src/styles/shadcn.css`. **After `add`, check `src/main.css` and `package.json`:** the CLI re-inserts a Google Fonts `@import` and icon packages. The editor must load nothing from other sites, and an e2e test enforces that. Confirmations use `confirmAction()` with `<ConfirmHost>` (an in-page AlertDialog), never the browser's blocking `confirm()`.
- **Validation at the boundary.** `useDocumentStore.load` checks models from storage with the engine's `validateModel` (later, the same check applies to Worker responses), and catches any exception from `generate`. Bad data shows an error, never a blank page.
- **Storage.** Until the backend exists, models live in browser storage. `BrowserModelStore` implements `ModelStore` and is seeded once with the migrated sample models from `app_models/` and `sample.json` (`src/data/samples.ts`). Samples are upgraded with `upgradeSample` (e.g. legacy stock header photos become banners). When it changes, bump `SAMPLES_VERSION`: browsers that seeded older samples run `upgradeSeeded` once over all stored models, so `upgradeSample` must change only what it recognises and return the same object otherwise. The upgrade never blocks startup: invalid models are skipped and errors are logged. The app gets its store from `src/services.ts`; tests swap in a `MemoryModelStore`.
- **Engine imports.** The app imports the engine's TypeScript source through the `@feature-domain/source` export condition: `customConditions` in tsconfig, and `resolve.conditions` in `vite.config.ts`, which keeps Vite's defaults.
- **Tests.** Vitest + Vue Test Utils (jsdom) in `test/`. Playwright in `e2e/` runs against a production build, and every external request is blocked except a mocked GitHub API.
- **TypeScript is pinned to 6.x** for the whole workspace (root `overrides`). `vue-tsc` needs TypeScript's JavaScript API, which TypeScript 7 (the native Go compiler) doesn't ship.

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
