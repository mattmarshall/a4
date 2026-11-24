# Proposal

## Why

The `lib/` root mixes unrelated domains: page geometry, analysis, lenses,
samples, settings, zip, import, and export. The analysis itself is one large
module that mixes metrics, classification, thresholds, and verdicts
(review A3–A5, A7, A9, A10, S11, T3). The next features need these pieces
on their own:
- a CI lint command needs the analysis without the browser;
- a server backend needs the store contract without the UI.

## What Changes

- **Domain folders, each with a public `index.ts`:**
  - `lib/page/`: spec (geometry and `PRESET_IDS`), layout (normalize,
    `layoutRows`, `rowsUsed`), chars (the cell-unit contract, one
    `countInk`), and geometry (mm↔cell, shared by flat, 3D, and the
    Workbench zoom).
  - `lib/analysis/`: config, classify, syntax, terms, tokens, metrics,
    signals, assess, and report.
  - `lib/persist/`: store, autosave, folder, and settings.
  - `lib/archive/`: zip, unzip, export, and import.
  - `lib/content/`: samples, templates, and the Welcome page.
  - `lib/render/`: element, paper, paint, and palette. Code moves here;
    the internal split is refactor-sheet-element.
  - `lib/models/` stays.
  - `lib/workspace/` and `lib/platform/` from refactor-workspace-controller
    stay.
- **Analysis config:** a typed `AnalysisConfig` (verdict, findings, and
  classify sections) with `DEFAULT_CONFIG satisfies AnalysisConfig`, passed
  as `analyze(text, spec, config?)`.
  - Each value cites its spec, or is marked unspecified.
  - The heading width follows `spec.cols`, not 80. This doesn't change
    results on Terminal; on other presets, headings are judged by that
    preset's width.
- **Analysis results are split** into `Layout`, `Metrics` (plain,
  serializable numbers), and `Assessment` (verdict and findings), so the
  painter and a CLI take only what they need.
- **An analysis report proto:** `proto/a4/v1/analysis.proto`
  (`AnalysisReport`: metrics, verdict, findings) with an encoder, ready for
  a CI lint command.
- **A strict core config:** `tsconfig.core.json` for `lib/page`,
  `lib/analysis`, and `lib/archive` adds `noUncheckedIndexedAccess`,
  `lib: ["ES2023"]`, and `types: []`. It runs in `pnpm typecheck`, so the
  core can't use DOM or Node APIs.
- **Boundary rules follow the new layout:**
  - `page` depends on nothing.
  - `analysis` depends on `page`.
  - `persist` and `models` depend on `page` and `platform`.
  - `workspace` depends on `persist`.
  - `components` import only folder `index.ts` files.

## Capabilities

### New Capabilities

### Modified Capabilities

(None: behavior is unchanged, so `skip_specs` is set.)
- On the Terminal preset, every number shown in the UI and every test value
  is unchanged.
- The heading-width rule is parameterized: Terminal is unchanged, and other
  presets apply their own width. That makes the existing spec's intent exact
  rather than changing it.

## Impact

- **Files:** every `lib/*.ts` at the root moves, along with its imports in
  `components/`, `app/`, `scripts/`, and the tests. `lib/analyze.ts` is
  split.
- **New:** `proto/a4/v1/analysis.proto` and `tsconfig.core.json`.
- **Config:** the boundary rules in `.dependency-cruiser.cjs`.

## Out of scope

- A CLI command (`a4 lint`): a later feature that this change enables.
- Element and renderer internals: refactor-sheet-element.
