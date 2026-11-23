# Proposal

## Why

A page of agent context is a fixed grid of 80 × 60 cells, so it is already a
small, exact tensor. Today, though, only A4's own heuristics read it.
Engineers want models to read and write the same sheet too. Embeddings could
find sentences that say the same thing in different words, a frontier model
could rewrite an overflowing page until it fits, and later, models trained on
sheets could judge them. Each of those needs the same foundations: a lossless
encoding of the sheet, one contract every model plugs into, and a privacy gate
that keeps page text on the device unless the author sends it.

## What Changes

- **Sheet tensor codec.** Page text encodes losslessly into a fixed-shape grid
  and back. The grid holds one UTF-16 code unit per cell in row-major
  `[rows, cols]` order, plus per-row lengths and continuation flags, exactly
  matching the editor's row layout. A page that fits encodes as `[60, 80]` on
  the Terminal preset.
- **An `a4.v1` protobuf contract** for anything that crosses a boundary: the
  sheet record (spec, text, grid), per-cell planes, embeddings, text spans and
  cell rectangles, model cards, and a `SheetModel` service with Describe,
  Encode, Score, Transform, and Generate operations.
- **A plugin host in the browser.**
  - Bundled plugins declare what they do, which views they read (text, grid,
    or pixels), where they run, and whether page text leaves the device.
  - In-browser plugins run in a Web Worker and exchange protobuf messages.
  - The host, not the model, decides whether output fits the page.
- **Model lenses.** Per-cell values from a Score operation show on the sheet
  as a lens, in 3D and Flat. `<a4-sheet>` accepts these values through a new
  method, and paints them only while the text matches what was scored.
- **Semantic repetition** (first Score plugin):
  - An embedding model runs in the browser and flags sentences and fields that
    restate one another.
  - It downloads once, on request, and no page text leaves the device.
- **Fit to page** (first Transform plugin):
  - Claude (`claude-opus-5-5`) rewrites the page to fit, called directly from
    the browser with the author's own API key.
  - Every call asks for consent first, and the key is kept in memory only.
  - The host checks the fit and asks for up to two repairs.
  - The result opens as a new page in Compare; the source page is never
    changed.

## Capabilities

### New Capabilities
- `sheet-tensor`: the lossless text ↔ grid codec, its shape and padding rules,
  the text-offset ↔ cell mapping, and the `a4.v1` sheet record.
- `model-plugins`: the plugin contract (model cards, operations, views), the
  host and its transports, host-enforced page fit, and the privacy gate for
  plugins that send text off the device.
- `semantic-repetition`: the in-browser embedding scorer: its units,
  similarity thresholds, model lens, and summary.
- `fit-to-page`: the consented Claude rewrite: consent, key handling, the repair
  loop, and where the result goes.

### Modified Capabilities
- `visual-lenses`: "One active lens" now includes model lenses, and a new
  requirement defines how a model lens paints.
- `a4-sheet-element`: a new requirement for receiving model planes and showing
  them as a lens.

## Impact

- **New code:**
  - `proto/a4/v1/*.proto` and generated code under `lib/gen/`.
  - `lib/tensor/` for the codec.
  - `lib/models/` for the host, registry, worker transport, and plugins.
  - New workbench UI for plugins, consent, and the key.
- **Changed code:**
  - `lib/element/a4-sheet.ts` (planes, model lens painting) and
    `lib/paper/texture.ts` (heat painting).
  - `components/Workbench.tsx` and `components/MetricsPanel.tsx`.
- **New dependencies:**
  - `@bufbuild/protobuf` (runtime), and `@bufbuild/buf` with
    `@bufbuild/protoc-gen-es` (generation).
  - `@anthropic-ai/sdk`, loaded only when Fit to page runs.
  - An in-browser inference library, loaded only when the semantic repetition
    model is used.
- **Network:**
  - Fit to page sends the page to `api.anthropic.com`, only after consent.
  - The embedding model's weights are downloaded once, after the author asks.
  - Nothing else changes; analysis stays local.

## Out of scope

- **Generate**: no Generate plugin yet (the operation is in the contract, but
  nothing implements it), and no turning embeddings back into text.
- **Trained models**: training grid-native models, and exporting the library
  as training data. The sheet record is designed for this; a later change adds
  the exporter.
- **Pixel view**: producing it for plugins. The contract names it, but no
  plugin reads it yet.
- **Outside plugins**: loading plugins from URLs or third parties, and plugins
  served over HTTP. Only bundled plugins run in this change.
- **Other providers**: the contract is provider-neutral, but the only rewrite
  adapter is Claude.
- **Keys**: remembering the API key across reloads, and server-side keys.
  The Worker never sees page text or keys.
- **Built-in analysis**: model output never changes the verdict or the
  built-in metrics.
