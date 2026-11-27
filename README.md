# A4

**One page of context.** A4 quantizes an A4 sheet into a grid of monospace
cells (80 columns × 60 rows = 4,800 cells, roughly 1,000 tokens of prose).
You write the context you plan to hand an AI agent directly on the sheet, and
A4 shows whether it is an efficient representation or a busy one: how much of
the page it fills, how much of the ink is syntax, what repeats, and whether it
reads as narrative or as fragments.

- Production: https://a4.marsh.build
- Concept (problem, approach, and narrative practice): [docs/concept.md](docs/concept.md),
  also served in the app at `/why`
- Platform proposal (A4 as paper for agents, and Letters):
  [docs/platform.md](docs/platform.md)
- Requirements: [openspec/](openspec/) (spec-driven, see below)

## Quick start

Requires Node 24+ and pnpm.

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | vinext dev server (Vite, running in workerd) |
| `pnpm test` | Unit tests for `lib/`, the UI's pure modules in `components/`, and the `a4` command in `cli/` (Node's built-in test runner) |
| `pnpm typecheck` | `tsc --noEmit`, then the strict core config (`tsconfig.core.json`) |
| `pnpm lint` | All the lint guardrails below, in order (also runs in CI) |
| `pnpm lint:code` | Biome: lint TypeScript and JSON, and check their formatting |
| `pnpm lint:deps` | dependency-cruiser: import boundaries and cycles |
| `pnpm lint:unused` | knip: unused files and dependencies fail; unused exports are reported |
| `pnpm lint:css` | stylelint on every stylesheet in `app/` and `components/` |
| `pnpm lint:casts` | Fail on a branded id cast outside its parser, or an undocumented `as unknown as` |
| `pnpm lint:element-types` | Fail if `types/a4-sheet.d.ts` differs from the element's attribute table |
| `pnpm gen:element-types` | Regenerate `types/a4-sheet.d.ts` from the attribute table (commit the result) |
| `pnpm format` | Format TypeScript and JSON with Biome |
| `pnpm build` | Production build to `.cloudflare/output`, with `/` and `/why` prerendered |
| `pnpm build:element` | The standalone `<a4-sheet>` module, `dist/element/a4-sheet.js` (no framework) |
| `pnpm check:bundle` | After a build, fail if the home page's first load contains plugin code or a model library |
| `pnpm start` | Serve the production build locally in workerd |
| `pnpm proto` | Lint `proto/` and regenerate the protobuf code in `lib/gen/` (commit the result) |
| `pnpm proto:check` | Fail if `lib/gen/` differs from a fresh generation, or `proto/` breaks compatibility with `main` (also runs in CI) |
| `pnpm check` | lint, test, typecheck, proto:check, build, check:bundle, and build:element |
| `pnpm a4 lint [path ...] [--strict] [--exclude <glob>] [--json]` | Check context files and letters against one page (see "Page lint") |
| `pnpm a4 letters [folder] [--latest \| --json]` | List a folder's letters, or print the newest accepted one (see "Letters") |
| `pnpm a4 stacks [folder] [--json]` | List a folder's stacks with their page budgets (see "Stacks") |
| `pnpm a4 stack <name> [folder] [--letter]` | Print a stack's pages, with the latest letter on top, for a session-start hook |
| `pnpm a4 xray [folder] [--budget <pages>] [--json]` | Count what Claude Code loads before its first turn, in pages (see "Context X-ray") |
| `pnpm a4 mailroom [folder]` | Serve a folder's letters to an agent over MCP on stdio (see "Mailroom") |
| `pnpm a4 share <file> [<file>]` | Print a share link to a page or a pair (see "Share links") |
| `pnpm a4 open <link> [--out <folder>]` | Write a share link's pages to new files (see "Share links") |
| `pnpm a4 serve <folder> [--port <n>] [--origin <url>] [--new-token]` | Serve a library of Markdown files to A4 on this machine (see "Served library") |
| `pnpm a4 plugin keygen \| pack \| verify` | Make signing keys, and pack and check plugin packages (see "Third-party plugins") |
| `node --env-file=.env.local scripts/fit-smoke.ts [out.md] [--rows N]` | One real Fit to page run against Claude with your key (a few cents). `--rows` shrinks the page |
| `node scripts/screenshots.ts capture <dir> [--url <origin>]` | Capture 33 fixed views of a running server (default `pnpm start` on port 4173) in headless Chrome, in light and dark: Single, Compare, both drawers, focus mode, every lens, the prose pages, and print to PDF. Keep captures under `.screenshots/` (ignored by git) |
| `node scripts/screenshots.ts compare <a> <b>` | Compare two captures pixel by pixel, and their PDF page counts. Writes `<view>.diff.png` for each view that differs, and exits 1 |
| `pnpm run deploy` | Deploy the Worker to Cloudflare (see below). Use `run`: bare `pnpm deploy` is a built-in pnpm command |

### Guardrails

`pnpm check` runs every guardrail locally, and CI runs the same ones on every
push and pull request.

- **Compiler:** strict TypeScript, plus `exactOptionalPropertyTypes`,
  `noImplicitReturns`, `noImplicitOverride`, `noFallthroughCasesInSwitch`,
  `verbatimModuleSyntax`, and `erasableSyntaxOnly`.
  `tsconfig.core.json` also checks the pure core (`lib/page`, `lib/analysis`,
  and `lib/archive`) with `noUncheckedIndexedAccess` and without DOM or Node
  types: only the web-standard globals in `types/core/web.d.ts`.
- **Biome** (`biome.json`): the recommended rules, plus unused imports, type
  imports, and unhandled promises as errors. Non-null assertions, nested
  ternaries, and `role="group"` divs are warnings until the refactors reach
  them. Code that breaks a rule on purpose carries a `biome-ignore` comment
  with the reason.
- **Import boundaries** (`.dependency-cruiser.cjs`):
  - No cycles.
  - `lib/` doesn't import `components/`, `app/`, React, or the `@/` alias.
  - UI code doesn't statically import plugin code or the model libraries.
  - Components and pages import a `lib/` folder only through its `index.ts`.
  - The `lib/` layers point one way: `page`, `content`, and `platform`
    depend on nothing; `analysis` on `page`; `persist` on `page` and
    `platform`; `models`, `render`, and `workspace` on the layers below
    them. The header of `.dependency-cruiser.cjs` lists each layer.

  dependency-cruiser reads TypeScript with the TypeScript 6 API, so
  `pnpm-workspace.yaml` gives it its own TypeScript 6.
- **Unused code** (`knip.jsonc`): unused files and dependencies fail. Unused
  exports are reported. `lib/models/plugins/semantic/calibration-pairs.ts` is kept on
  purpose: it's the fixture set for recalibrating the semantic thresholds by
  hand.
- **CSS** (`.stylelintrc.json`): the standard rules are all errors, and
  `!important` and duplicate selectors fail. Two rules of our own
  (`scripts/stylelint-*.ts`) keep every rule inside a cascade layer and make
  each `var(--name)` without a fallback name a token that `app/globals.css`,
  the palette, or the file itself defines. Module classes are camelCase.
- **Branded ids** (`scripts/cast-report.ts`): page names, file paths,
  revisions, trash ids, and plugin ids are minted only by their parsers, so a
  cast such as `x as PageName` anywhere else fails. `as unknown as` fails too,
  except in the files the script lists with the reason (worker scope typing,
  the Anthropic SDK boundary, and test fakes).
- **Element types:** `types/a4-sheet.d.ts`, the JSX types of `<a4-sheet>`, is
  generated from the attribute table in `lib/render/element/contract.ts`, and
  `pnpm lint` fails when it's stale.
- **Protobuf compatibility:** `buf breaking` compares `proto/` with `main`
  locally, and in CI with the pull request's base or the previous `main`
  commit. The worker transport (`proto/a4/v1/rpc.proto`) is exempt: a worker
  and its page always ship together.
- **First load:** the build records each client chunk's modules in
  `dist/client-chunks.json`. `pnpm check:bundle` fails if the chunks the home
  page loads contain the Fit to page adapter, the semantic worker,
  `@anthropic-ai/sdk`, `@huggingface/transformers`, or `onnxruntime-web`.

## The workspace

The app is exactly one window tall. One row of controls sits at the top, and
the desk fills the rest, with the page as large as the window allows. Every
other control is one click away.

- **Top bar**, left to right:
  - the A4 mark;
  - **Pages**, which opens the library;
  - the page's name and save status;
  - the lens, with **Semantic** beside the built-in lenses;
  - **Single** or **Compare**;
  - zoom: −, the percentage (select it to fit the page again), and +;
  - three menus, described below;
  - the **Inspector** toggle.

  Below 1,360 px wide, the bar tightens to stay one row down to 1,100 px:
  Pages shows only its icon, and the save status shows only its colored dot
  (hover it for the text).
- **Page menu**: new pages (blank, the templates, the worked samples, and
  Welcome), **Copy text**, **Download .md**, **Print**, and **Clear**.
- **View menu**: the grid preset, **Show cell grid**, **3D** or **Flat**,
  **Fit to the desk** or **Actual size (1:1)**, **Pose and camera**, and
  **Focus mode**.
- **Help menu**: **Why A4?** (`/why`) and the `<a4-sheet>` element
  (`/element`).
- **On the desk**: in 3D, **Fold** plays the letter fold, and **Pose…** opens
  the fold, curl, tilt, turn, and light controls in a small panel. Close it
  with × or Esc. Any lens other than Ink shows its legend as a chip in the
  desk's lower-left corner.
- **Inspector**: the analysis on the right, in sections:
  - Verdict, The page, and Findings start open.
  - Shape, Most repeated, and Models start closed.
  - Select a section's title to open or close it. The browser remembers each
    section's state.
  - Findings shows its count even while closed.
  - Turning on a model lens opens Models.
  - In Compare, the inspector compares the two pages.
- **Hiding the inspector**: its toggle gives the desk the full width, and the
  verdict then shows as a chip in the top bar. Below 1,100 px wide, the
  inspector and the library open as drawers over the desk, and the inspector
  starts hidden.
- **Focus mode**: choose **View → Focus mode**, or press **F** when no text
  field or sheet has focus. Only the desk and the page remain. Esc or the
  **Exit focus** pill brings everything back. Typing F on the page just types
  an F.
- **Fit**: at **Fit to the desk**, the page fits the desk's width and height
  in both 3D and Flat, so the whole sheet shows without scrolling.

## How it works

- **Page model** (`lib/page/`): A4 geometry in millimeters. The
  Terminal preset uses 2.225 × 4.45 mm cells centered with 16/15 mm margins.
  Pica, Elite, and Dense presets derive their grids from characters-per-inch
  and lines-per-inch. The screen scales everything by one `--mm` factor, and
  print uses true millimeters.
- **Editor** (`lib/render/element/`): the `<a4-sheet>` custom element
  (see below). A transparent `<textarea>` sits in its shadow root over the
  page, painted on a canvas from the grid model. Text uses IBM Plex Mono
  (0.6 em advance, so a glyph is exactly one cell), plus
  `white-space: break-spaces` and `line-break: anywhere`. Lines therefore wrap
  after exactly `cols` characters, matching the row model in `lib/page/layout.ts`.
- **Analysis** (`lib/analysis/`): pure functions for fill,
  overflow, coverage, crowding, syntax overhead, repetition, duplicate lines,
  indentation, narrative share, estimated tokens, compressibility, the verdict,
  and findings. Thresholds live in `DEFAULT_CONFIG` (`lib/analysis/config.ts`),
  each citing the spec that pins it or marked unspecified.
- **Lenses** (`lib/analysis/lenses.ts`): Ink, Syntax, Repetition, Structure, and
  Tokens. They are presentation only and never change the text.
- **Styles** (`app/globals.css`, and a `*.module.css` beside each panel):
  - Every rule sits in a cascade layer, lowest first: Tailwind's `theme`,
    `tokens`, `base` (Tailwind's preflight, then ours), `components`,
    `utilities`, `layout`, and `print`. Tailwind supplies only the preflight.
    Each module repeats the order statement, since the first stylesheet to
    load sets the order.
  - Panels use CSS modules (`styles.item`). The shared primitives (`.btn`,
    `.seg`, `.select`, `.menu-*`, `.eyebrow`, and the lens swatches) stay
    global in the `components` layer.
  - Tokens in `globals.css` name the type sizes (`--text-<px>`), radii,
    z-indexes, and hover tints. The sheet's colors come from
    `lib/render/palette.ts`: the build writes them as `--a4-*` properties at
    the `a4:palette` marker in `globals.css`, and a test fails if one of
    those colors is written anywhere else.
  - Breakpoints are defined once, in `components/breakpoints.ts`. CSS writes
    `@media (--bp-medium)`, `(--bp-narrow)`, or `(--bp-small)`, which the build
    resolves; scripts call `mediaQuery(name)`. A test fails on a stylesheet
    that writes its own width query.
  - Print: `data-print="hide"` hides an element and `data-print="flow"` drops
    its screen layout, from the last layer, so print needs no `!important`.
- **Privacy**: everything runs in the browser, and nothing is sent to a
  server.

## The `<a4-sheet>` element

Every sheet in the app is one `<a4-sheet>`: a self-contained custom element
with its text input, renderer, and styles in its own shadow root. It needs no
framework. The workbench renders one sheet in **Single** and two in
**Compare**. **3D** is the default rendering and **Flat** is the alternative;
both edit the same text.

```html
<script type="module">
  import { defineA4Sheet } from "./a4-sheet.js";
  defineA4Sheet(); // registers <a4-sheet>; safe to call more than once
</script>

<a4-sheet value="Purpose: brief the agent." lens="syntax" curl="0.4"></a4-sheet>
```

| Attribute | Values |
| --- | --- |
| `value` | Initial text. After that, use the `value` property. |
| `render` | `auto` (3D when WebGPU is available, the default), `3d`, or `flat` |
| `preset` | `terminal`, `pica`, `elite`, `dense` |
| `size` | `a4` (the default), `a5`, or `a6`: the paper, down the fold ladder (see "Page sizes") |
| `lens` | `ink`, `syntax`, `repetition`, `structure`, `tokens`, or `model:<name>` for a plane set with `setPlane` |
| `fold-bottom`, `fold-top`, `curl` | 0 to 1. Curl and folds are exclusive. |
| `tilt`, `turn`, `light` | 0–65°, −180–180°, and light azimuth in degrees |
| `zoom` | CSS px per millimeter, or `fit` (the default) |
| `grid`, `label` | Show the cell grid. Accessible name for the text input. |
| `readonly` | Stop editing: typing, pasting, dropping, cutting, and undo change nothing. Selecting, copying, lenses, the fold, and print still work. |

`pnpm build:element` writes that module, `dist/element/a4-sheet.js`, which
exports `defineA4Sheet` and `A4SheetElement`. `defineA4Sheet(name)` registers
the sheet under another tag too; each extra name gets its own subclass.

- **Attributes are requested values.** After the user orbits the camera or
  `fold()` plays, the `view` and `pose` properties read what is shown, and
  the attributes keep what was asked for. Setting an attribute always
  applies, even when it equals the previous value, so setting `tilt` again
  resets the camera.
- **Properties and methods**: `value` (setting it fires no event and keeps
  the caret), `readOnly` (reflects `readonly`), `selectionStart`, `selectionEnd`, `render` (the rendering in
  use), `view` (`{ tilt, turn }` shown now), `pose` (fold and curl amounts
  shown now), `setSelectionRange()`, `focus()`, and `fold()` (the letter-fold
  animation, or a toggle under reduced motion).
- **Text input**: Tab inserts two spaces. Tabs and carriage returns in
  pasted, dropped, or autocorrected text become two spaces and newlines, in
  the same undo step as the insertion, and never while an input method is
  composing.
- **Model planes**: `setPlane(name, { text, values, label })` stores one value
  in [0, 1] per cell of `text`'s grid, and `lens="model:<name>"` shows it as a
  tint in 3D and Flat. The tint is painted only while the sheet's text equals
  `text`; otherwise the sheet shows Ink. A plane of the wrong size throws a
  `RangeError`. `removePlane(name)` drops one, and `planeNames` lists them.
  The React wrapper takes them as a `planes` prop.
- **Events**, all composed so they cross the shadow boundary: `input` on
  every edit, `a4-focus`, `a4-render` (`"3d"` or `"flat"` once settled),
  `a4-viewchange` (`{ tilt, turn }` after a drag on the desk), and
  `a4-posechange` (the pose after `fold()`).
- **Styling hooks**: `--a4-font`, `--a4-desk`, `--a4-3d-height`,
  `--a4-radius`, and `--a4-shadow`.
- **Print**: each element prints as one true-size page of its paper (A4, A5,
  or A6) of plain black text at the preset's cell size and margins, whatever
  its rendering or pose. Each sheet asks for the named page of its size
  (`page: a4`, `a5`, or `a6`), so a page that prints sheets of mixed sizes
  declares them:

  ```css
  @page a4 { size: a4; margin: 0; }
  @page a5 { size: a5; margin: 0; }
  @page a6 { size: 105mm 148mm; margin: 0; }
  ```
- **Demo**: `/element` shows two elements built from plain HTML markup.
- **React**: `components/A4Sheet.tsx` wraps the element. It defines it on the
  client, writes each prop's attribute whenever the prop changes (so a reset
  applies after an orbit), sets `value` only when it differs, and forwards
  events. Its handle is `{ focus, select, fold }`, and each call waits until
  the element is defined.
- **Inside**: the element composes four controllers, `EditorSurface` (the
  textarea), `FlatView`, `PaperView` (3D, with its renderer lifecycle and
  pointer input), and `PrintLayer`, and keeps its display state in a pure
  reducer (`lib/render/element/state.ts`).

### 3D rendering

The 3D rendering draws the page as a sheet of paper with WebGPU. You can fold
it into a letter, curl the bottom-right corner, tilt it, turn it, and light it
from any side, and you can keep editing it.

- **Texture from the model** (`lib/render/paint/`): the page is painted
  from A4's own grid (cells, rows, lens colors, rulers, gauge, caret,
  selection), one character per cell, so positions match the flat rendering
  exactly. Each layer is a function over a `Paint2D` context and a
  `PageModel` (rows, line kinds, lens styles, plane), so the sheet paints
  without running the whole analysis. Colors come from
  `lib/render/palette.ts`, which the element's CSS also uses. The browser can't run shaders over DOM pixels, and Chrome's
  experimental HTML-in-Canvas API maps hit testing with a single flat matrix,
  which can't follow a folded sheet.
- **Deformations** (`lib/render/paper/deform.ts`): two folds with rounded creases at
  99 mm and 198 mm (the letter fold), and a cylinder curl from the corner.
  Each is an isometry, so the paper never stretches, and tests check that.
  The paper is deformed only here, on the CPU, when the pose changes: each
  vertex's position, normal, and crease are uploaded, and the shader only
  transforms them.
- **Only what changed**: the texture is repainted when the content changes
  (text, lens, plane, selection, grid, preset). Orbiting rewrites the camera
  uniforms and folding the vertices, without repainting the text.
- **Shading** (`lib/render/paper/renderer.ts`):
  - Diffuse light plus a soft highlight.
  - Paper grain and darker creases.
  - A plain back side.
  - A planar shadow on the desk, using `min` blending so overlapping layers
    don't double-darken.
  - 4× MSAA.
- **One GPU device** (`lib/render/paper/gpu.ts`) is shared by every sheet on the
  page, from the `GpuProvider` in `A4SheetElement.gpu` (an embedder can set
  its own). Zoom works in 3D too: at a fixed zoom, an untilted sheet spans
  the same CSS width as the flat rendering.
- **Editing**: the real textarea stays mounted but invisible, and keeps focus.
  A click on the sheet becomes a ray, which hits the nearest triangle of the
  CPU copy of the deformed mesh. The hit gives a paper position in millimeters,
  then a grid cell, then a text offset, and `setSelectionRange` puts the caret
  there. Dragging selects. Typing, undo, paste, IME, and autosave work the
  same as in Flat, and the caret stays put when you switch renderings. Drags
  on the desk turn the camera, and clicks on the back of the paper do nothing.
- **Without WebGPU** the element falls back to Flat and reports it with
  `a4-render`. The workbench then disables 3D and says why. A lost GPU
  device recreates 3D once; a second loss falls back to Flat. The console
  says why a sheet renders flat.

## Models and the sheet tensor

A page is a fixed grid of cells, so models can read and write it as a tensor.
Page text stays the single source of truth; every model view is derived from
it.

### The sheet tensor

`lib/tensor/codec.ts` encodes page text into a grid and back without loss:

- **Cells**: one UTF-16 code unit per cell, row-major, laid out exactly as the
  editor lays out rows. A row breaks after `cols` cells or at a newline. For
  every character in the Basic Multilingual Plane a cell holds its Unicode
  code point; an emoji takes two cells, as it does in the editor.
- **Shape**: `[max(preset rows, rows used), cols]`. A page that fits always
  has the preset's shape, `[60, 80]` on Terminal. An overflowing page keeps
  every row, and `rows_used` says how many hold text.
- **Row metadata**: each row's length and whether it continues a wrapped line.
  Cells past a row's length hold 0, so NUL characters and newlines need no
  sentinel values.
- **Round trip**: decoding returns exactly the encoded text, which property
  tests check over thousands of generated strings.

`lib/tensor/cells.ts` maps text offsets to cells and back, and text spans to
the cells they cover. The renderers use the same mapping for picking and the
caret.

### The `a4.v1` contract

Anything that crosses a worker, process, or file boundary is a protobuf
message from `proto/a4/v1/`:

- `sheet.proto`: `Sheet` (spec, text, grid), `Grid`, `PageSpec`, `Plane`
  (per-cell values plus the text they were computed for), `TextSpan`, and
  `Embedding`.
- `model.proto`: `ModelCard` and its capabilities (`ScoreCapability`,
  `TransformCapability`, and `CredentialRequirement`), the
  `SheetModelService` operations (Describe, Status, Prepare, Encode, Score,
  Transform, Generate), and the `ErrorCode` every model error carries.
- `rpc.proto`: `RpcFrame`, the worker transport's message: a call, a cancel,
  a streamed message, an end, or an error, each tagged with its call's id.
- `library_event.proto`: `LibraryEvent`, what a tab tells the others when the
  page list changes or a page is saved.

`lib/tensor/record.ts` reads and writes `Sheet` records. A reader rejects a
record whose grid isn't exactly the encoding of its text, and names the first
row that differs. A sheet the host sends a plugin may carry only the text or
only the grid; `verifySheet` checks the views it declares. A full Terminal page is about 10 KB on the wire: about 5 KB
of text and 5 KB of grid, one byte per ASCII cell.

Generated code is JavaScript with `.d.ts` files, not TypeScript, because the
Node test runner strips types and can't run TypeScript `enum`s. Edit the
`.proto` files, then run `pnpm proto` and commit `lib/gen/`.

### Model plugins

Every model plugs into the same contract, `SheetModelService`. `lib/models/`
holds the host, the transports, and the manifest, and each bundled plugin
has a folder under `lib/models/plugins/`.

- **Model cards.** A plugin describes itself with a card that gives:
  - its name and what it does;
  - its operations;
  - the sheet views it reads: text, grid, or pixels (reserved);
  - its presets;
  - where it runs: in the browser, or on a remote service at a named host;
  - whether it sends page text off the device;
  - for Score, its planes (each with a label and scale), scores, and
    finding kinds; for Transform, its instructions and most attempts;
  - any credential it needs, such as an API key.

  The inspector's Models section and the Semantic legend render from the
  cards, with one panel slot per plugin for its own controls. A card and its
  typed score, finding, and plane names live in the plugin's light
  `descriptor.ts`, so listing cards loads no model code.
- **Operations.** Encode turns a sheet into embeddings, and Score into
  per-cell planes, named scores, and findings. Transform turns a sheet into a
  new sheet, and Generate turns source material into one. The host calls
  only the operations a card declares. Any other request is refused without
  contacting the plugin.
- **Presets and instructions.** The host refuses a preset or a Transform
  instruction the card doesn't declare, without contacting the plugin.
- **Views.** A plugin receives only the views its card declares. When a sheet
  carries both, the text and grid describe the same page.
- **Planes.** A Score plane must match the scored grid's shape and carry the
  text it was computed for. The host rejects any other plane.
- **The host decides fit.** For Transform and Generate, the host lays out each
  result on the page's preset: a result fits in 60 rows on Terminal. If it
  doesn't fit, the host asks again with the overflow, for at most the
  attempts the card declares (3 for Fit to page), and keeps the attempt with
  the fewest rows. A plugin can't claim to fit.
- **No overwrites.** Model output never changes an existing page, the verdict,
  or the built-in metrics. Transform and Generate results become new pages,
  and Score results appear only as model lenses and model summaries.
- **Privacy gate.** A plugin that sends page text off the device needs a
  consent token for every call. The host owns the `ConsentBroker`, only the
  confirmation dialog can mint a token, and each token is:
  - bound to one plugin, one operation, and one exact page text;
  - usable once.

  One egress guard checks every call that sends text off the device,
  including remote scoring. Without a fresh, matching token, the host refuses
  the call before the plugin runs.
- **Credentials.** The host keeps keys in memory, in a `CredentialStore`
  keyed by plugin and credential kind. A plugin gets a getter for the kinds
  its card declares, and the host refuses any other kind.
- **On-device plugins stay on the device.** An in-browser plugin makes no
  network request carrying page text. It downloads model files only after you
  ask, shows the size first, and keeps them for later sessions.
- **Where plugin code comes from.** Plugin code comes from one of two places:
  - **Bundled plugins.** The manifest (`lib/models/manifest.ts`) is the only
    place a bundled plugin is registered: one `definePlugin` entry with its
    descriptor and lazy `connect` and `isDownloaded`. A plugin needs a
    download when its card's `download_bytes` is above 0.
  - **Installed plugins.** These are signed packages that you installed
    yourself (see "Third-party plugins"). The registry
    (`lib/models/registry.ts`) registers them after the bundled plugins.

  No plugin code is loaded from page content or imports. Code comes from a
  URL only when you install from it or check it for an update. UI code
  imports descriptors, never a plugin's implementation.
- **Worker isolation.** In-browser plugins run in a module Web Worker, so
  editing stays responsive. Every message over the worker port is an
  `RpcFrame` protobuf. A frame that can't be decoded but has a call id gets
  an error reply, so a call never waits forever.

### Semantic repetition

The first bundled model. It finds sentences and fields that say the same
thing in different words, which the string-based Repetition lens can't see.

- **Using it.** In the inspector's Models section, choose **Download (38.0 MB)**
  once. Then turn on the **Semantic** lens, next to the built-in lenses.
  - The sheet tints each unit on a continuous scale by how close its nearest
    match is in meaning: faint at 0.60 (loosely related) up to the darkest
    at 1.0 (the same idea). Unrelated text stays clear.
  - The inspector counts the units that restate another (0.85 or more). It also
    lists the 5 closest pairs on the page at 0.60 or more, each with its
    similarity and a swatch of its tint. Selecting a pair selects the later
    sentence, the one to consider cutting.
  - While the lens is on, the page is rescored 1,500 ms after you stop typing.
    Until then the sheet shows Ink rather than stale values.
- **Units.** A unit is a sentence in a prose paragraph (a list item starts a
  new paragraph), or a whole structured or heading line. Units with fewer
  than 12 non-whitespace characters are skipped.
- **Scale.** A unit's cells hold `clamp((s − 0.60) / 0.40, 0, 1)`, where `s`
  is its highest cosine similarity to another unit. It counts as restating at
  0.85 or more. A shorter sentence that repeats part of a longer one often
  lands between those (about 0.7), so it shows as a lighter tint and in the
  list, without being counted as a restatement. Units identical apart
  from case and whitespace don't count, since duplicate lines are reported
  already. Calibration data is in the archived changes' `calibration.md` files.
- **Privacy.** Everything runs in a Web Worker in your browser, and scoring
  makes no network request.
- **What the download contains:**
  - The model, `Xenova/all-MiniLM-L6-v2` at an 8-bit quantization (23.7 MB,
    Apache-2.0), from Hugging Face, pinned to one commit.
  - The ONNX runtime's WebAssembly build (14.3 MB), served by this app rather
    than a CDN.

  Both are cached in the browser. After the first download, scoring works
  without a network.
- **Loading.** The page checks the browser cache to see whether the model is
  downloaded, and starts the worker only if it is, or when you download it.
  The worker is an ES module. Its small shell loads first, and the inference
  library loads as a separate chunk only when it's needed.
- **Build notes** (`vite.config.ts`):
  - A build plugin drops the ONNX runtime's WebGPU-capable WebAssembly
    builds, which the app never loads. One of them is over Cloudflare's
    25 MiB asset limit.
  - Another plugin keeps transformers.js's `typeof window` guard intact in
    worker builds; the bundler would otherwise fold it away and throw in a
    worker. It fails the build if a library update changes that line.
  - `browserOnlyPlugins()` resolves each plugin's `connect.ts` to a stub
    outside client builds, so the worker and the ONNX runtime stay out of
    the server bundle.

### Fit to page

Claude rewrites the active page so it fits on one sheet and reads as
narrative data. The result opens beside the original, which never changes.

- **Your key, held in memory.** Enter your own Anthropic API key in the Fit
  to page card. It stays in this tab's memory only: it is never written to
  localStorage, page files, exports, or logs, and it's forgotten on reload or
  when you choose **Forget key**. A rejected key is forgotten right away.
- **Confirm every request.** Each run first shows what will be sent, in the
  same dialog that confirms every plugin that sends page text away:
  - the destination, `api.anthropic.com` (Anthropic);
  - the plugin: Fit to page, built into A4;
  - the model, `claude-opus-5-5`;
  - the page and its character count.

  The page and key go directly from your browser to Anthropic, and A4's
  server never sees them. If Claude declines, Anthropic may retry the request
  with a fallback model. Choosing **Cancel** sends nothing, and the next run
  asks again.
- **The page has to fit.** A4, not the model, lays out each result: it fits
  when it uses no more rows than the preset has, 60 on Terminal. If a result
  overflows, A4 asks again with the number of rows over, for up to 3 attempts
  in all. If none fits, it keeps the one with the fewest rows and tells you by
  how much it is over.
- **The result.** A new page, "‹name› (fit)" (numbered if that name is
  taken), opens as B in Compare, with the original as A. A rejected key, a
  network failure, a refusal, or **Cancel** creates no page.
- **Cost.** The run is billed to your key. A page is about 1,000–2,000 input
  tokens, and a run usually costs a few cents, or up to about $0.50 with
  three attempts and thinking, at the model's $4 / $20 per million tokens.
- **Local key for scripts.** Put your key in `.env.local` as
  `ANTHROPIC_API_KEY=…`. The file is gitignored, and env files never reach
  the build output. Scripts read it with `node --env-file=.env.local`; the
  browser app doesn't read it. Never rename it with a `VITE_` prefix: Vite
  would bundle it into browser code.
- **How it calls Claude.** The Anthropic TypeScript SDK loads only when you
  first run it, and is created with `dangerouslyAllowBrowser: true`. That is
  the SDK's opt-in for exactly this case: the user's own key in their own
  browser. Requests stream at `medium` effort with adaptive thinking, and
  server-side refusal fallbacks are on.

## Pages, storage, and autosave

The library holds any number of pages. You can search, create (blank or from
a template), rename, duplicate, delete to the trash, restore, and delete
permanently. Each page is stored as a Markdown file whose content is exactly
the page text, so a file can be handed to an agent as is.

```
<Origin Private File System>/
  a4/
    pages/<page name>.md    one file per page
    trash/<page name>.<deleted-at>.md
```

- **Typed store** (`lib/persist/store/`): the contracts in `lib/persist/store/types.ts` use
  content-hash `Revision`s for conflict detection and typed errors.
  - **Core** (`PageFiles`): list, read, create, and write. Every backend
    implements it.
  - **Library** (`PageStore`): adds rename, trash, restore, and purge, keyed
    by validated `PageName` values.

  The library backends are:
  - `OpfsPageStore`, the default.
  - `KeyValuePageStore` over `localStorage`, used where OPFS writable files
    are unavailable. Its pages move into OPFS once OPFS is available.
  - `MemoryPageStore`.

  **Name claims.** Library backends hand out names under a per-name Web Lock
  (`a4:page:<lowercased name>`), so two tabs never claim one name:
  - `createUnique(desired, text)` picks "Brief", "Brief 2", and so on, and
    creates the page while holding the name's lock. Every caller that needs
    a free name uses it.
  - `restore` claims its name the same way.
  - `rename` holds both names' locks, taken in sorted order.
  - A rename that changes only case goes through a temporary
    "<name> (renaming)" page, because storage that ignores case sees the two
    spellings as one file.

  `FolderPageFiles` implements only the core, for a folder you open (see
  [Folders](#folders)). New backends must pass the shared suites in
  `lib/persist/store/testing/contract.ts`: `pageFilesContract` for the core, and
  `pageStoreContract` for a library backend.

  The core suite treats revisions as opaque, so the folder runs it twice:
  - on the raw files;
  - through `sheetFiles`, the view autosave sessions use, with sheet text
    (no tab, CR, or byte-order mark) and the file's own revisions and size.
- **Autosave** (`lib/persist/autosave/`):
  - Every edit is journaled to `localStorage` synchronously, per tab and
    page.
  - The page is saved 600 ms after typing pauses, and at least every 4 s
    while typing continues.
  - Saves also happen on tab hide, page switch, and Ctrl/Cmd+S.
  - Failed saves retry with backoff.
  - If another tab saved first, your text is kept as a "(conflict …)" copy.
  - Drafts left by a crashed or closed tab are recovered on the next load.
- **Cross-tab**: a `BroadcastChannel` tells other tabs to refresh, and an idle
  tab reloads a page another tab saved. Each message is an
  `a4.v1.LibraryEvent` (`proto/a4/v1/library_event.proto`): the page list
  changed, or a named page was saved. For one release, tabs also accept the
  bare string earlier versions posted, so a tab still on the old version
  refreshes this one during a deploy.
- **Durability**: on the first edit, A4 asks the browser for persistent storage
  (`navigator.storage.persist()`). The library footer shows the active backend
  and whether storage is persistent.
- **Export**: **Export all** in the library first saves any pending edits.
  It then downloads `a4-pages-<date>.zip`, which holds
  `a4-pages-<date>/<page name>.md` for every page, with the trash left out.
  The zip encoder (`lib/archive/zip.ts`) has no dependencies: it uses the browser's
  `CompressionStream("deflate-raw")` and writes UTF-8 file names.
- **Import**: **Import .zip** turns every `.md` and `.txt` file in an archive
  into a page named after the file. Folders inside the archive are ignored,
  and text is normalized the same way as pasted text. Import never changes an
  existing page:
  - A file whose name and text both match an existing page is reported as
    unchanged, so re-importing an export creates no duplicates.
  - A file whose name matches but whose text differs comes in as "Brief 2".

  Import skips `__MACOSX/` metadata, hidden files, other file types, binary
  files, and damaged entries, and reports what it did. The reader
  (`lib/archive/unzip.ts`) has no dependencies. It refuses archives that are not zips,
  use Zip64, hold more than 5,000 entries, or expand to more than 50 MB, and it
  checks these limits before inflating anything. While inflating, it stops at
  each entry's declared size and verifies every checksum. Tests run it against
  archives made by Info-ZIP, macOS Finder (`ditto`), and Python
  (`lib/archive/fixtures/`).
- **Upgrading**: text from the earlier single-page version (`a4:text:a` and
  `a4:text:b`) is imported as pages on first load. The old keys are kept.

## Folders

Open a folder, such as a repository, to edit its agent context files in place
as A4 pages. This needs a browser with a folder picker: Chrome or Edge. In
Safari and Firefox, the Pages panel says so, and the library works as before.

- **Opening:** choose **Open folder…** below the library list, and allow A4
  to edit the folder. A4 shows one folder at a time and remembers it.
  **Close** saves open files and forgets the folder; files are never changed
  by closing.
- **What's listed:**
  - **Context files**, at any depth: `AGENTS.md`, `CLAUDE.md`,
    `CLAUDE.local.md`, `GEMINI.md`, `SKILL.md`, Markdown in
    `.claude/agents/` and `.claude/commands/`,
    `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`,
    and `.cursor/rules/*.mdc`. Each shows its rows on the 80 × 60 Terminal
    grid, in red when it runs over 60.
  - **Other Markdown**, in a collapsed group.
  - **Skipped:** `.git`, `node_modules`, `dist`, `build`, `out`, `target`,
    `vendor`, `.next`, `.venv`, and other dot-folders (except `.claude`,
    `.github`, `.cursor`, and `.agents`). The scan stops after 20,000
    entries. Files over 1 MiB, and files that aren't UTF-8 text, are listed
    with the reason and don't open.

  The search box filters folder files by path.
- **Editing:** a file opens like any page, with the same metrics, lenses, 3D,
  copy, download, print, and Compare. The header shows the folder and the
  path; files can't be renamed or deleted from A4.
- **Faithful saves:** edits save to the file with the library's autosave
  timing. Lines you didn't touch keep their exact bytes: tabs, CRLF line
  endings, a byte-order mark, and the final newline. On the sheet, tabs show
  as two spaces; an edited line is saved as you see it. A file longer than
  one page is never cut short. Opening a file without editing it never
  writes it. (`lib/persist/folder/faithful.ts` diffs the file's lines against the
  sheet's and keeps every matched line.)
- **Changes made elsewhere:** while the tab is visible, A4 checks the open
  files every second. A file changed by an editor, an agent, or
  `git checkout` reloads if you have no unsaved edits. If you do, A4 never
  overwrites the file: your version is saved as a library page,
  "AGENTS.md (conflict …)", and opens in its place.
- **Copies go to the library**, never the folder: conflict copies, edits to a
  file deleted on disk ("(recovered …)"), recovered drafts that no longer
  apply, Fit to page results, and **Duplicate to library**. They're named
  after the path, with `/` shown as `›`.
- **Creating files:** **+ New file** in the folder section creates a file at
  a path you give (`.md` or `.mdc`), and **Page → Save to folder…** writes the
  open library page to a new path. Neither overwrites an existing file or
  writes outside the folder.
- **After a reload:** the folder reconnects by itself when the browser keeps
  the permission (Chrome's "Allow on every visit"). Otherwise the folder
  section shows **Reconnect**, and the files you had open reopen once you
  allow it. A moved or deleted folder shows **Folder not found**.
- **Privacy:** files are read and written on this device; nothing about them
  is uploaded. Fit to page still asks before each call.
- **Under the hood:** the folder's handle is kept in IndexedDB (`a4` →
  `folders`), and its drafts in `localStorage` under `a4:folder:<id>:`.
  While Chrome saves a file, a temporary `<file>.crswap` appears next to it
  for a moment.

## Page sizes

A-series paper halves when folded and keeps its shape, and so does a page.
Each fold halves the paper; cells keep their size, so text reads at the same
point size, and the margins shrink with the paper.

| Size | Paper | Terminal grid | Cells | Token ceiling |
| --- | --- | --- | --- | --- |
| A4, a page | 210 × 297 mm | 80 × 60 | 4,800 | ≈1,200 |
| A5, a card | 148 × 210 mm | 56 × 42 | 2,352 | ≈588 |
| A6, a postcard | 105 × 148 mm | 40 × 29 | 1,160 | ≈290 |

- **A page's size comes from its name.** A name ending in `.a5` or `.a6`
  before its extension, such as `auth-card.a5.md` or the library page
  "Deploy note.a6", is that size. Every other page is A4, so `CLAUDE.md` and
  `AGENTS.md` always are.
- **Everywhere a page is judged:**
  - the sheet in 3D and flat;
  - print, at true size;
  - the inspector's rows and token ceiling;
  - Compare, where each sheet keeps its own size, shown true to scale beside
    the other;
  - `a4 lint`, letters (an A5 letter is a card), and stacks;
  - the mailroom's `size`;
  - Fit to page, which fits a card to 42 rows.
- **The other presets fold too.** Pica, Elite, and Dense derive their A5 and
  A6 grids the same way.
- **No model folds a page.** You or an agent write the smaller page, and the
  desk says whether it fits.

## Page lint

`a4 lint` checks a repository's agent context files against one page from the
command line, so a file that stops fitting is caught in review or CI.

```sh
pnpm a4 lint                              # this repository
node ~/src/a4/cli/a4.ts lint              # any folder, from a checkout of A4
node ~/src/a4/cli/a4.ts lint AGENTS.md docs/brief.md --strict
```

```
pass   1/60  Light        .claude/skills/review/SKILL.md — Reads clean
fail  74/60  Overflowing  AGENTS.md — 14 rows over the page
warn   6/60  Noisy        packages/api/CLAUDE.md — 37% of the ink is syntax
3 files: 1 failed, 1 warned, 1 passed.
```

- **What it checks:**
  - Given a folder (the current directory by default), it checks the context
    files the folder view lists, at any depth: `AGENTS.md`, `CLAUDE.md`,
    `SKILL.md`, and the rest. It also checks the letters in
    `.agents/letters/` (see "Letters") and the stack pages in
    `.agents/stacks/` (see "Stacks"), and judges each stack's budget.
  - It skips the same folders as the folder view, and stops after 20,000
    entries, saying so on stderr.
  - A file named on the command line is checked whatever its name.
  - Each file is measured as the sheet shows it, on the Terminal page of its
    size: 80 × 60 for A4, or 56 × 42 and 40 × 29 for a card (`.a5.md`) and a
    postcard (`.a6.md`; see "Page sizes"). Tabs count as two spaces, and CRLF
    as a newline.
- **Pass and fail:**
  - A file **fails** when it uses more rows than its size holds (60, 42, or
    29). Trailing blank lines don't count.
  - A stack **fails** when it's over its page budget or a page is over its
    size, and **warns** without a budget or when a line repeats across its
    pages.
  - A Noisy or Busy file **warns**. With `--strict`, it fails too.
  - A file over 1 MiB, or one that isn't UTF-8, fails with its reason.
- **Each line shows** the outcome, the rows used, the verdict, the path, and
  the file's most severe finding, in the app's words.
- **Options:**
  - `--strict` also fails Noisy and Busy files.
  - `--exclude <glob>` skips files whose folder-relative path matches. Repeat
    it for more globs, for example to leave out generated skills:
    `--exclude '.claude/skills/**'`.
  - `--json` prints only an `a4.v1.LintReport` (`proto/a4/v1/lint.proto`) as
    proto3 JSON. That's each file's path, outcome, and `AnalysisReport`, and
    never a file's text.
- **Exit status:** 0 when no file fails, 1 when one does, and 2 for a usage
  error or a path that doesn't exist.
- **Privacy:** it only reads files, never writes them, and makes no network
  request.
- **Under the hood:** the command (`cli/a4.ts`) hands the Node folder adapter
  to the headless desk (`lib/desk/`). The desk judges a page with the same
  fit rule (`pageFit` in `lib/page/`), analysis, and folder walk the app uses,
  and imports no DOM or Node API, so other tools can reuse it.
- **This repository's own context files** are generated OpenSpec skills, 215
  to 527 rows each, so `pnpm a4 lint` here fails until they're excluded.

## Letters

A letter is a one-page handoff between agent sessions. An agent writes one at
the end of a session, a person reads it in A4 and seals it, and the next
session starts from the newest accepted letter.

- **Where they live:**
  - A letter is a `.md` file directly in a repository's `.agents/letters/`
    folder.
  - Name letters with a UTC timestamp first, such as
    `2026-11-25-0930-auth-migration.md`, so sorting by name sorts by time.
    Letters are ordered by name without the `.md`, so `…-letter.md` comes
    before `…-letter-2.md`.
  - Any agent or editor can write one. **New letter** in the folder view
    starts one from the Handoff form, named
    `<UTC YYYY-MM-DD-HHMM>-letter.md`. Agents file them through the mailroom
    (see "Mailroom"), which checks the fit first.
- **The postmark:**
  - Sealing writes `<letter>.postmark.json` beside the letter. It's an
    `a4.v1.Postmark` (`proto/a4/v1/letter.proto`) in proto3 JSON, recording:
    - the letter's name;
    - its digest, the SHA-256 of the file's exact bytes as
      `urn:a4:letter:sha256:<hex>`;
    - the verdict, accepted or returned, and the reason;
    - the signer's name;
    - the time (RFC 3339, UTC);
    - the digest of the previous accepted letter.
  - A4 never changes the letter's bytes, and never overwrites or deletes a
    postmark.
- **States:**
  - **Draft:** no postmark.
  - **Accepted** or **Returned:** the postmark matches the letter's bytes.
  - **Broken seal:** the letter changed after it was sealed, or the postmark
    can't be read. A broken letter is never delivered.
- **In the app:**
  - With a folder open, the Pages panel lists letters in a **Letters** group
    above Context files, newest first, with each one's state and rows.
  - Opening a letter puts the letter before it in A and this one in B, in
    Compare.
  - On a draft, **Seal…** asks you to **Accept** it, or to **Return** it with a
    reason. A letter over 60 rows can't be accepted.
  - The first seal asks for your name, and this browser remembers it.
  - Accepting plays the letter fold in 3D.
  - A sealed letter opens read-only, with a chip giving its verdict, signer,
    and time.
  - A seal records that you read the letter and accepted or returned it. It
    doesn't make the letter true, and it isn't a signature: the name
    identifies you but doesn't authenticate you.
- **From the command line:**
  - `pnpm a4 letters [folder]` lists the letters, oldest first, with state,
    rows, signer, and reason.
  - `--json` prints an `a4.v1.LetterList`, without letter text.
  - `a4 letters --latest` prints the exact text of the newest accepted letter
    whose seal is intact. It then prints a short note for each letter returned
    since, with its reason.
  - When there's nothing to deliver, it prints nothing, notes that on stderr,
    and exits 0, so a hook never fails a session.
  - Like `a4 lint`, it only reads and makes no network request.

  A session-start hook can deliver letters. In Claude Code, for example, in
  `.claude/settings.json`:

  ```json
  {
    "hooks": {
      "SessionStart": [
        { "hooks": [{ "type": "command", "command": "node ~/src/a4/cli/a4.ts letters --latest" }] }
      ]
    }
  }
  ```
- **Line endings:** the digest covers exact bytes, so keep git from converting
  letters' line endings, or a checkout breaks their seals:

  ```
  .agents/letters/** -text
  ```

  in `.gitattributes`.
- **Under the hood:**
  - The desk (`lib/desk/letters.ts`) holds every rule: paths, digest, states,
    the parent, delivery, and sealing. The app and the command share it.
  - SHA-256 comes from Web Crypto through `lib/platform`.
  - The app seals under the folder's Web Lock for the postmark's path, so two
    tabs can't both seal a letter. On Node, the postmark is created
    exclusively, so two processes can't both write one.
  - The sheet's `readonly` attribute keeps sealed letters from being edited.

## Stacks

A stack is the pile of pages an agent is handed: a charter, a brief, a few
entity cards. It has a page budget, and A4 counts it in paper.

```
.agents/stacks/auth/
  stack.json          {"purpose": "Start an agent on the auth service", "budgetPages": 3}
  01-charter.md       A4: 1 page
  02-service.a5.md    A5 card: half a page
  03-owners.a6.md     A6 postcard: a quarter
```

- **Where they live:**
  - A stack is a folder directly in `.agents/stacks/`, named with lowercase
    letters, digits, and single hyphens (at most 40 characters).
  - Its pages are the `.md` files directly inside it, in name order (without
    the `.md`, as letters sort), so number them. Subfolders aren't pages.
  - A sheet lies on one stack only. Write each page for its stack's reader.
- **The label:** `stack.json` is an `a4.v1.StackLabel` (`proto/a4/v1/stack.proto`)
  in proto3 JSON, with the stack's `purpose` and its `budgetPages`, a whole
  number of pages.
- **Counting:** an A4 page counts as 1, an A5 card as 0.5, and an A6 postcard
  as 0.25, whatever its rows. Each page is judged on its own size.
- **Judging:**
  - A stack **fails** when it uses more pages than its budget, or a page is
    over its size or can't be read.
  - It **warns** without a label or budget, or when a line of 20 or more
    characters appears on two pages. A stack says each thing once.
- **In the app:** the Pages panel lists stacks in a **Stacks** group after
  Letters, with each stack's pages used out of its budget and its pages in
  order, each with its size and rows.
- **From the command line:**
  - `pnpm a4 stacks [folder]` lists stacks with their use, purpose, and
    problems; `--json` prints an `a4.v1.StackList`, without page text.
  - `pnpm a4 stack <name> [folder]` prints the stack's pages' exact text in
    order, each after a `--- <file name> ---` line. `--letter` puts the
    newest accepted letter on top. A failing stack is still printed, with its
    problems on stderr, and the command exits 0.
  - `a4 lint` judges each stack too (see "Page lint").
  - Like `a4 letters`, they only read and make no network request.

  A session-start hook can hand an agent its stack and the latest letter. In
  Claude Code, in `.claude/settings.json`:

  ```json
  {
    "hooks": {
      "SessionStart": [
        { "hooks": [{ "type": "command", "command": "node ~/src/a4/cli/a4.ts stack auth --letter" }] }
      ]
    }
  }
  ```

## Context X-ray

`a4 xray` shows what a coding agent carries before its first turn, counted in
pages. It follows Claude Code's loading rules and reads only files.

```
$ pnpm a4 xray
Claude Code loads these files before its first turn in “.”:
source  rows  pages  verdict      path
user      24    0.4  Balanced     ~/.claude/CLAUDE.md
project   90    1.5  Overflowing  CLAUDE.md
import    12    0.2  Light        docs/agents.md  (imported by CLAUDE.md)
skills    79   1.32  Overflowing  23 skill descriptions
Before its first turn, Claude Code loads 3.42 pages (≈3,000 tokens) from 4 sources.
```

- **What it reads, in load order:**
  - the managed policy `CLAUDE.md` for your operating system, then
    `~/.claude/CLAUDE.md` and the rules in `~/.claude/rules/`;
  - `CLAUDE.md`, `.claude/CLAUDE.md`, and `CLAUDE.local.md` in each folder
    from the filesystem root down to this one (`AGENTS.md` and
    `.claude/AGENTS.md` instead when there are none);
  - the folder's `.claude/rules/`;
  - every `@path` import, after the file that first imports it, up to four
    hops;
  - auto memory's `MEMORY.md` (its first 200 lines, at most 25 KB);
  - one index each for skill and subagent names and descriptions.
- **What it leaves out:**
  - rules with `paths` and `CLAUDE.md` files below the folder, which load
    only when the agent touches a matching file;
  - skills with `disable-model-invocation: true`.
- **What it can't count,** and says so: the system prompt, tool and MCP
  definitions, plugins, output styles, and session-start hook output. It
  measures files as written, so HTML comments the agent strips count.
- **Pages** are each source's rows on the A4 Terminal page divided by 60.
- **Options:**
  - `--budget <pages>` exits 1 when the total is over, for CI.
  - `--json` prints an `a4.v1.ContextXray` (`proto/a4/v1/xray.proto`).
- **Privacy:** it reads your home folder and the repository on the device,
  prints paths and numbers (paths under your home as `~/…`), and never prints
  a file's text.
- **This repository**, on the maintainer's machine, starts an agent with
  about 2.2 pages:
  - a user `CLAUDE.md`;
  - an `AGENTS.md` in a folder above the checkout;
  - 23 skill descriptions, which alone take 1.3 pages.

## Mailroom

`a4 mailroom` is a local MCP server for one repository's letters. An agent
checks a letter against the page, files it as a draft, and reads the latest
letter a person accepted. Any MCP client can register it, whether it's a
coding agent, a harness, or a review system.

| Tool | Annotations | What it does |
| --- | --- | --- |
| `lint_page` | `readOnlyHint: true` | Judges text on the 80 × 60 page, like `a4 lint`, or on a card or postcard with `size` (`a5`, `a6`). It returns rows used, rows over, the verdict, and findings, and writes nothing. |
| `write_letter` | `readOnlyHint: false`, `destructiveHint: false` | Files `text` as a new draft, `.agents/letters/<UTC YYYY-MM-DD-HHMM>-<topic>.md` (topic default `letter`). With `size` `a5` or `a6` it files a card or a postcard, `…-<topic>.a5.md`. It doesn't file a letter over its size's rows (60, 42, or 29); the agent gets the rows over and the findings, and rewrites. It never writes over a file: a taken name gets `-2` to `-9`. |
| `read_letter` | `readOnlyHint: true` | Returns the letter `a4 letters --latest` delivers: the newest accepted letter with its seal intact, its signer and digest, and a note for each letter returned since. Given a `digest`, it returns that letter if it was accepted, or else says its state. It never returns a draft's text. |

- **No tool seals.** Agents write, people seal, in the app's seal dialog.
- **The `letter` prompt** asks the agent to write a handoff letter from the
  Handoff form, check it with `lint_page`, and file it with `write_letter`.
  Claude Code shows it as `/mcp__a4__letter`.
- **Results:** each tool returns text for the model and, as structured
  content, an `a4.v1.PageCheck`, `a4.v1.FiledLetter`, or
  `a4.v1.LetterDelivery` (`proto/a4/v1/mailroom.proto`) in proto3 JSON. Each
  record repeats the text in its `note`, because some clients (Claude Code
  among them) show the model only the structured content.
- **Privacy:** it speaks MCP on standard input and output only and makes no
  network request. It reads only its folder, and creates only new letters in
  `.agents/letters/`. Accepted letters' text goes only to the agent that
  started it.

**Register it** (the folder is where the agent starts, so start your agent at
the repository root, or name the folder after `mailroom`):

```sh
claude mcp add a4 -- node ~/src/a4/cli/a4.ts mailroom
claude mcp add --scope user a4 -- node ~/src/a4/cli/a4.ts mailroom   # every repository
```

Keep it at local or user scope: a project's `.mcp.json` would commit your
checkout's path. Other clients take the usual entry:

```json
{
  "mcpServers": {
    "a4": { "command": "node", "args": ["/path/to/a4/cli/a4.ts", "mailroom"] }
  }
}
```

**Session hooks for coding agents:**
- **Start:** the `SessionStart` hook under "Letters" (`a4 letters --latest`)
  hands the agent the latest accepted letter before its first turn.
- **End:** the mailroom's instructions ask the agent to file a letter before
  it finishes or when its context runs low. `/mcp__a4__letter` asks for one
  on demand. Nothing forces a letter: a hook that blocks the agent from
  stopping fires after every turn, not once a session.

A harness that runs agents itself can call `write_letter` at each checkpoint
and `read_letter` when the next task starts. It can use the digest that
`write_letter` returns to ask about the letter after a person seals it.

## Share links

A share link carries the page itself, so a person or an agent can hand
someone a page to read in A4. A server never holds it: the page is in the
link's fragment, the part after `#`, which browsers don't send to a server.

- **The format.** The link is `https://a4.marsh.build/#s1.` followed by an
  `a4.v1.SharedPages` message (`proto/a4/v1/share.proto`), compressed with
  raw DEFLATE and encoded as base64url. `s1.` is the format version. Each
  page carries:
  - its name, which is the library name or the file's name, never its folder
    path;
  - its preset and paper size;
  - its text, as exact UTF-8 bytes;
  - for a sealed letter, its postmark.

  The grid isn't sent, since it follows from the text.
- **Limits.**
  - A link holds one page, or two as a pair.
  - A link is at most 16,384 characters. A full page of prose makes a link of
    about 3,000. A page too large for a link is refused, with a pointer to
    Download.
  - A link is read up to 1 MiB decompressed.
- **Sharing.** Choose **Page → Copy share link**, or in Compare, **Copy share
  link for A and B**. The link goes to the clipboard, like Copy text. Anyone
  holding it can read the page, and URLs end up in browser history and chat
  logs.
- **Opening.** A link opens the page read-only, on the preset and size its
  sender saw, with its verdict, metrics, and lenses. A pair opens in Compare.
  - Nothing is stored: your library, folder, open pages, and settings stay as
    they were.
  - **Save a copy** adds each page to your library under its own name. A
    taken name gets a number, so "Brief" becomes "Brief 2".
  - **Close** brings back the pages you had open.
  - Both remove the link from the address bar.
  - Copies show on your own preset from then on.
- **Sealed letters.** A sealed letter's link carries its postmark. The shared
  view shows who accepted or returned it and when. It also checks the
  shared bytes against the postmark's digest: the seal is intact, or broken
  because the letter changed after it was sealed.
  - **A seal isn't proof.** It records that the named person accepted the
    letter; it doesn't prove who sealed it, and anyone can make a link.
  - **Nothing a link carries becomes a postmark.** A saved copy is a library
    page, and `a4 open` writes only text. So a link can't put an "accepted"
    letter in a repository for `a4 letters --latest` to deliver.
- **From the command line:**

  ```sh
  node ~/src/a4/cli/a4.ts share .agents/letters/2026-11-25-0930-auth.md
  node ~/src/a4/cli/a4.ts open 'https://a4.marsh.build/#s1.…' --out notes
  ```

  - **`a4 share <file> [<file>]`** prints a link to one page or a pair.
    - Each page's size comes from its name, and its preset is Terminal.
    - A letter with a postmark beside it carries its seal.
    - It exits 1 when the link would be too long, and 2 for a missing file.
  - **`a4 open <link> [--out <folder>]`** writes each page to a new file
    named after it.
    - It never overwrites one: it exits 2, and writes neither page of a
      pair.
    - It prints a letter's seal, and never writes a postmark.
    - It exits 1 for a link it can't read.

  Neither makes a network request.

## Served library

`a4 serve` keeps a page library as Markdown files in a folder on your
machine, and A4 shows it in place of this browser's library. An agent, an
editor, or `git` works on the same files the sheet shows.

```sh
node ~/src/a4/cli/a4.ts serve ~/notes/a4
```

- **The folder.** Pages are `pages/<name>.md`, holding exactly the page text,
  and trashed pages are in `trash/`, as in this browser's library. The
  library's token is in `.a4-serve-token`. A missing folder is created.
- **The library's id.** `.a4-library` names the library, so A4 keeps its
  unsaved edits and open pages apart from any other folder's, even one
  served on the same port later.
  - It's made the first time the folder is served, and kept across restarts
    and `--new-token`.
  - It isn't secret.
  - A copied folder carries it along, and its token too: delete
    `.a4-library` and `.a4-serve-token` in the copy to make it a library of
    its own, and open the new link it prints. A4 learns a library's id when
    it connects or switches to it, so serving the copy behind the same
    address and token would keep the original's id.
  - If the file is edited so it no longer holds an id, `a4 serve` exits 2:
    delete it to give the library a new id.
- **The command.** It prints its address and a link that connects A4, then
  serves until Ctrl-C.
  - **`--port <n>`** listens on another port (default 4320; 0 picks a free
    one).
  - **`--origin <url>`** also allows another origin, such as
    `http://localhost:5173` for a development server. It prints a link for
    each origin.
  - **`--new-token`** replaces the token, which disconnects every browser.
    The library's id stays the same, so opening the new link brings back
    its open pages.
  - It exits 2 for a folder it can't use or a port that's taken.
- **What keeps it private.**
  - It listens on 127.0.0.1 only, and answers only requests whose `Host` is
    that address, or `localhost`, with its port. That stops DNS rebinding.
  - Only `https://a4.marsh.build`, and any `--origin`, may call it. A request
    from another origin, or with none, gets 403.
  - Every request carries the library's token, 32 random bytes kept in
    `.a4-serve-token` (readable only by you), and reused across runs so a
    connected browser stays connected. A wrong token gets 401. If the folder
    is a git repository, add `.a4-serve-token` and `.a4-library` to its
    `.gitignore`.
  - Page text goes only between this browser and 127.0.0.1. a4.marsh.build
    still stores nothing.
  - It keeps out web pages, not programs: anything running as you can read
    the folder anyway.
- **The protocol.** One POST per call to
  `/a4.v1.PageStoreService/<Method>`, with protobuf bodies
  (`proto/a4/v1/store.proto`).
  - A store error comes back as a `StoreFailure` with a typed detail, so a
    conflict, a taken name, or a file that isn't UTF-8 behaves as it does
    in this browser.
  - `GetLibrary` returns the library's id and the protocol version.
  - The served store, and the store over HTTP, pass the same contract tests
    as this browser's.
- **Versions.** A4 and `a4 serve` must speak the same protocol version,
  and A4 checks before it shows the library.
  - A server from an older checkout is refused, with a note to update the
    checkout and restart it.
  - A server newer than the open A4 tab is refused, with a note to reload
    A4.
  - Either way, nothing is read from or written to that server.
- **Connecting.** Open the link it prints:
  `https://a4.marsh.build/#serve=127.0.0.1:4320.<token>`. A4 connects,
  shows the served pages, remembers the connection in this browser, and
  removes the token from the address bar. A4 connects only to 127.0.0.1 or
  localhost.
  - **When the link can't be clicked,** choose **Connect a4 serve…** in the
    Pages panel and enter the address and the token (the end of the link,
    after the last dot).
  - **The Connect form checks the server first.** If A4 can't use it, the
    form stays open and says why, with what to do (see below), and nothing
    is remembered. The address and token stay filled in to correct.
  - **The link is remembered even then,** and a notice says why A4 can't use
    the server, so switching works once it runs.
- **Switching.** The Pages panel switches between **This browser** and
  **a4 serve**. Every library action works on the one shown. Each library
  keeps its own open pages, unsaved edits, and other-tab updates, a served
  one by its id. So switching back shows each as you left it, and a
  different folder served at the same address starts fresh. The open
  folder stays open.
- **Changes on disk.** While the served library is shown in a visible tab,
  A4 lists it every 2 seconds. A page added, removed, or changed on disk
  shows up within 5 seconds. An open page with no unsaved edits shows the
  new text; one with unsaved edits keeps both versions when it saves, as a
  conflict with another tab does.
- **When A4 can't use the server.** Starting on, switching to, or
  connecting to the served library then shows this browser's library,
  changes nothing, and says why, with what to do:
  - **not running:** start `a4 serve` and switch again;
  - **refused this browser's token** (it was restarted with
    `--new-token`): open the link it printed;
  - **older or newer than this A4:** see Versions;
  - **an answer A4 can't read:** restart it, and update your checkout if
    that doesn't help.

  Edits typed while it stopped stay in this browser, and are saved to the
  served library when you switch back with it running.
- **Disconnect** forgets the address and token in this browser and shows
  this browser's library. The folder's files stay as they are, and the
  library's open pages come back when it's connected again.
- **The two libraries don't sync.** To copy pages from one to the other, use
  **Export all** and **Import .zip**.

Chromium may ask once whether A4 can reach devices on your local network:
allow it. Safari's handling of a secure page reaching 127.0.0.1 has varied
by version; if it can't connect, use Chrome or Firefox.

## Third-party plugins

Anyone can publish a pen (a plugin that writes a new page from yours) or an
overlay (one that scores your page and tints it). A third-party plugin speaks
the same `SheetModelService` as the bundled ones, and A4's host holds it to
the same rules:
- consent before any page text leaves the device;
- fit decided by the desk;
- results that never overwrite your page.

A signature says who made a plugin. A sandbox makes the privacy rules hold
whoever made it.

### The package

A plugin ships as one `.a4plugin` file: an `a4.v1.PluginPackage`
(`proto/a4/v1/plugin.proto`) of at most 16 MiB, with three parts.
- **The manifest,** which is what the publisher signs:
  - the model card;
  - the publisher's name and 32-byte Ed25519 public key;
  - the code's SHA-256 digest, as a `urn:sha256:` URN;
  - any model files (each an HTTPS URL, a size, and a digest);
  - the time it was signed.
- **The signature,** Ed25519 over `a4.v1.PluginManifest\n` followed by the
  manifest's bytes exactly as stored.
- **The code,** one script that imports nothing. It runs as a classic
  worker.

**What A4 checks.** A4 accepts a package only when all of these hold:
- the signature verifies with the manifest's own key;
- the code matches its digest;
- the model files' sizes add up to the card's download size.

**What a card may say:**
- **Id:** lowercase letters, digits, dots, and hyphens, in at most 64
  characters, like `example.word-length`.
- **Version:** `MAJOR.MINOR.PATCH`.
- **Operations:** Score, Transform, or both.
- **Placement:** in the browser, or on a remote service. A remote card names
  one plain hostname: no scheme, port, path, wildcard, or IP address.

**The publisher's fingerprint** is the first 16 bytes of SHA-256 of their
key, in 8 groups of 4 hex digits. The key is the publisher's identity; the
name is what they call themselves.

### Writing a plugin

A plugin is a card in proto3 JSON and a script that calls `servePlugin` from
the kit (`lib/models/kit/serve.ts`) once. The host's first message to the
worker is an `a4.v1.PluginStart`, which carries:
- the model files the host downloaded;
- the credentials the card declares;
- the port to serve `SheetModelService` on, in `a4.v1.RpcFrame`s.

The kit answers Describe with the card, and `spanPlane` lays text spans out
as a plane of the page's shape.

Two examples live in `examples/plugins/`:
- **Word length**, an overlay, tints each word by its length.
- **Hard wrap**, a pen, rewraps long lines at 72 columns.

`pnpm build:examples` bundles each one into `dist/example-plugins/<name>.js`,
and signs a package beside it with a throwaway key it keeps in that folder.

### Publisher commands

`a4 plugin` makes keys and packages and checks them. It never runs a
plugin's code and makes no network request.

```sh
mkdir -p ~/.config/a4
pnpm a4 plugin keygen ~/.config/a4/publisher.key
pnpm build:examples
pnpm a4 plugin pack --card examples/plugins/word-length/card.json \
  --code dist/example-plugins/word-length.js \
  --key ~/.config/a4/publisher.key --publisher "Your name" \
  --out dist/word-length.a4plugin
pnpm a4 plugin verify dist/word-length.a4plugin
```

- **`keygen <file>`** writes a new Ed25519 private key, readable only by you,
  and prints its public key and fingerprint. It never prints the private key,
  and it never overwrites a file (exit 2).
- **`pack`** takes the card (`--card`), the script (`--code`), your key
  (`--key`), and the name you publish as (`--publisher`). It also takes
  `--file <path>=<https url>` for each model file. It then:
  - computes every digest and size, and sets the card's download size;
  - checks the card as A4 does when it installs;
  - signs the manifest.

  It writes `<id>-<version>.a4plugin`, or `--out`. A card A4 would refuse
  writes nothing (exit 1).
- **`verify <file>`** checks a package as A4 does before installing it. It
  prints what the plugin does, where it sends text, what it downloads and
  asks for, and who signed it (exit 1 if refused).

### Trust

- **Known publishers.** A4 ships a list of known publishers in
  `lib/models/publishers.ts`. A package signed by a listed key shows the
  list's name with a Known publisher badge. Any other package shows "Unknown
  publisher" and the name it gives itself. The list starts empty, and a key
  is added only by a reviewed change to A4.
- **Pinned keys.** Installing a plugin pins its id to the key that signed it.
  A package with that id from any other key is refused, and so is a third-party
  plugin that takes a bundled plugin's id.
- **Updates.** An update installs only if the same key signed it and its
  version is newer.
- **No key rotation.** A publisher who loses a key ships under a new id.

### In the app

- **Installing.** Under Models, choose **Install plugin…**, then pick a
  `.a4plugin` file or paste an HTTPS URL.
  - **A URL** is fetched only when you choose Check, with no cookies, no
    referrer, and no page text. A URL that isn't HTTPS is refused without a
    request.
  - **If the host doesn't allow the download,** A4 suggests downloading the
    file and installing it from the file.
  - **The dialog** shows what the plugin does, where page text goes, what it
    downloads, the credentials it asks for, and its publisher and fingerprint.
    Nothing is stored until you choose Install.
- **The sandbox.** Installed plugin code runs only in a worker inside a
  hidden, sandboxed frame (`lib/models/sandbox.ts`). The frame's origin is
  opaque, so the plugin has no storage, no cookies, and no access to your
  pages or A4. The frame's content security policy comes from the signed
  card:
  - an overlay that keeps text on this device can make no network request
    at all;
  - a plugin that sends text off the device can reach only the one host its
    card names, and each call still asks for your consent.

  The plugin gets model files and credentials only from A4, which downloads
  the files after you ask and checks each one's digest.
  `experiments/plugin-sandbox/` records the sandbox holding against a plugin
  that tries every way out.
- **The self-test.** Before the first installed plugin runs in a tab, A4
  checks that this browser enforces the sandbox. If it doesn't, installed
  plugins don't run, and their cards say "This browser can’t sandbox installed
  plugins, so they don’t run here." Bundled plugins are unaffected.
- **Overlays.** Each plane an installed overlay declares becomes a model lens,
  and its legend names the plugin and its publisher.
  - An on-device overlay rescores 1,500 ms after you stop typing, like
    Semantic repetition.
  - A remote overlay scores only when you turn its lens on or choose Score
    again, with consent each time.
- **Pens.** An installed pen runs from its card in the Models section, in the
  same panel as Fit to page. You choose an instruction, enter any credential
  it asks for with **Use key** (kept in this tab's memory only, until **Forget
  key** or a reload), and run it. A pen that sends text away asks first, in
  the dialog Fit to page uses: it names the host, the pen with its version and
  publisher, its model, the page, and the characters sent. The host lays out
  each attempt, and the result opens as "<page> (<pen name>)" beside the
  source in Compare. The source never changes.
- **Model files.** A4 checks a model file against its digest when it
  downloads the file and each time the plugin starts. Between starts, the
  Models section only asks whether a file it already checked is still
  stored, so listing plugins doesn't reread a large model. If a stored file
  changed, the plugin doesn't start, and its card offers the download again.
- **Every load is checked.** When a tab loads its installed plugins, A4
  checks each one's signature and code, and a plugin runs only from the copy
  it checked. A stored plugin that fails the check is shown as damaged and
  doesn't run.
- **Updates and removal.**
  - **Check for update** fetches a plugin's URL only when you ask, and shows
    both versions and what changes: where text goes, the download size, and
    the credentials.
  - **Remove** deletes the plugin's code, its files, its pinned key, and its
    URL, and stops it, closing its sandbox even if it's still starting. Pages
    a pen made stay.
- **Every tab agrees.** An install, update, or removal reaches A4's other
  open tabs in this browser within 2 seconds, without a reload. They list the
  new plugin, run the new version, or stop the removed one: its lens turns
  off, its running pen stops, and its credentials and consent are forgotten.
  An update forgets the pen's credentials in every tab. A tab with no
  plugins doesn't load the plugin code until another tab installs one.
- **Not yet:** installed plugins run only in the app, not in the `a4`
  command, the headless desk, or the mailroom. Generate and Encode aren't
  offered to them.

## Deploy to a4.marsh.build

The Worker is defined in `cloudflare.config.ts` (name `a4`,
`domains: ["a4.marsh.build"]`). A deploy uploads a new Worker version,
promotes it, and applies the custom domain. That requires the `marsh.build`
zone to be on the deploying Cloudflare account.

### Continuous deployment (GitHub Actions)

`.github/workflows/deploy.yml` runs test, typecheck, and build on every push
and pull request. On pushes to `main` (or a manual run on `main`), it then runs
`pnpm run deploy` and smoke-tests `/`, `/why`, and a 404 on the live site.

The deploy job needs two repository secrets:

- `CLOUDFLARE_ACCOUNT_ID`: the account that owns the `marsh.build` zone.
- `CLOUDFLARE_API_TOKEN`: an API token created in the Cloudflare dashboard
  (My Profile → API Tokens) from the **Edit Cloudflare Workers** template.
  Scope it to that account and the `marsh.build` zone, and add
  **Zone → DNS → Edit** for the custom domain.

```bash
gh secret set CLOUDFLARE_ACCOUNT_ID --repo mattmarshall/a4
```

```bash
gh secret set CLOUDFLARE_API_TOKEN --repo mattmarshall/a4
```

Each command prompts for the value, so it never lands in shell history. If
the secrets are missing, the deploy job fails with a message that says so.
Pull requests never deploy.

### Manual deploy

```bash
pnpm exec cf auth login
```

```bash
pnpm run deploy
```

Use `run`: bare `pnpm deploy` is a built-in pnpm command. To roll back,
redeploy a previous Worker version from the Workers dashboard.

## OpenSpec

Requirements are managed with [OpenSpec](https://github.com/Fission-AI/OpenSpec).
The living specs are in `openspec/specs/`:

- **The page:** `page-grid`, `sheet-editor`, `density-analysis`,
  `visual-lenses`, and `page-comparison`.
- **The workspace:** `workspace-layout`.
- **Guidance and export:** `narrative-guidance` and `page-export`.
- **Pages and storage:** `page-library`, `page-storage`, `autosave`,
  `folder-pages`, and `served-library`.
- **The element and 3D:** `a4-sheet-element` and `paper-view`.
- **Models:** `sheet-tensor`, `model-plugins`, `semantic-repetition`, and
  `fit-to-page`.
- **Third-party plugins:** `plugin-packages` and `installed-plugins`.
- **Sharing:** `share-links`.
- **The command line:** `page-lint`.
- **Handoffs:** `letters` and `mailroom`.
- **Many pages:** `page-stacks` and `context-xray`.
- **Deployment:** `hosting`.

The changes that produced these specs, each with its proposal, design, and
tasks, are archived under `openspec/changes/archive/`:

- `2026-11-23-add-a4-workbench`
- `2026-11-23-add-page-library`
- `2026-11-23-add-zip-export`
- `2026-11-23-add-zip-import`
- `2026-11-23-add-paper-view`
- `2026-11-23-add-a4-sheet-element`
- `2026-11-23-add-sheet-model-plugins`
- `2026-11-23-add-semantic-overlaps`
- `2026-11-23-add-workspace-focus`
- `2026-11-23-add-folder-pages`
- `2026-11-23-fix-review-bugs`
- `2026-11-24-add-code-guardrails` (tooling only, with no spec changes)
- `2026-11-24-refactor-typed-contracts` (types only, with no spec changes)
- `2026-11-24-refactor-workspace-controller` (structure only, with no spec changes)
- `2026-11-24-refactor-lib-layout` (structure only, with no spec changes)
- `2026-11-24-refactor-model-plugins` (structure and contracts, with no spec
  changes)
- `2026-11-24-refactor-sheet-element`
- `2026-11-24-refactor-styles` (styles only, with no spec changes)
- `2026-11-24-fix-review-leftovers`
- `2026-11-25-add-headless-desk`
- `2026-11-25-add-letters`
- `2026-11-25-add-mailroom-mcp`
- `2026-11-25-add-stacks`
- `2026-11-25-add-signed-plugins`
- `2026-11-25-add-share-links`
- `2026-11-25-add-served-library`
- `2026-11-26-harden-served-protocol`
- `2026-11-27-harden-pens-and-plugins`
- `2026-11-27-finish-tech-debt-review`

```bash
openspec list --specs
```

```bash
openspec validate --specs --strict
```

Propose new work as a change (`/openspec-propose`), implement it
(`/openspec-apply-change`), then archive it to fold its deltas into
`openspec/specs/`.

## Known limitations

- Token counts are a heuristic estimate, roughly within 20% of BPE tokenizers.
  Use them to compare pages, not to budget exact model limits.
- Double-width characters (CJK, emoji) and glyphs outside IBM Plex Mono's
  Latin sets can break the one-character-per-cell grid.
