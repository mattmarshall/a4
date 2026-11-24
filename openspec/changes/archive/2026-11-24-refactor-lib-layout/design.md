# Design

## Context

- **Prerequisites:**
  - add-code-guardrails, for dependency-cruiser.
  - refactor-typed-contracts, for the `Finding` union, `VerdictId`, and the
    `as const` tables.
  - fix-review-bugs, for `signals()`.
- **Today:** `lib/analyze.ts` is 461 lines, `lib/page-spec.ts` mixes
  geometry with fonts, DPI, and UI copy, and the paper geometry is
  recomputed in more than a dozen places.

## Goals / Non-Goals

**Goals:**
- Each folder has one public `index.ts`.
- The pure core compiles without DOM or Node types.
- Analysis numbers are identical on Terminal.

**Non-Goals:**
- New analysis features.
- Changes to the CLI or the server.

## Decisions

### 1. Move in one commit per folder, with a codemod

- **How:** a script rewrites imports with the TypeScript language service's
  rename-file support, or with path rewrites checked by `tsc`, one folder
  per commit. There are no re-export shims at the old paths: every import
  is updated, so nothing depends on the old layout.
- **Order:**
  1. page
  2. analysis
  3. archive
  4. content
  5. persist
  6. render

  Each step keeps `pnpm check` and `pnpm lint` green.

### 2. Analysis split

```
analysis/config.ts    AnalysisConfig, DEFAULT_CONFIG (documented, spec-referenced)
analysis/classify.ts  classifyLines(lines, config.classify, cols)   (shared with models/semantic/units)
analysis/metrics.ts   metrics(layout, text, spec, config) → Metrics (numbers only)
analysis/signals.ts   signals(metrics, config) → Signals (from fix-review-bugs)
analysis/assess.ts    verdict(signals), findings(signals, metrics) → Assessment
analysis/report.ts    toReport(...) → AnalysisReport proto
analysis/index.ts     analyze(text, spec, config?) → { layout, metrics, assessment }
```

`termCounts` becomes a sorted array. Nothing serializes a `Map`.

### 3. One geometry module

`page/geometry.ts` holds the paper size, `cellRect`, `cellAt`, `rowTop`, the
fit scale, the pixel-ratio cap, and texture density. Flat, 3D picking,
print, and the Workbench zoom use it. Tests cover the fit branch that had
none.

### 4. The strict core config

`tsconfig.core.json` includes the page, analysis, and archive folders, with
`noUncheckedIndexedAccess`, `lib: ["ES2023"]`, and `types: []`. Index access
in those modules is fixed with explicit checks; the review counted 3 errors
in the analysis core. The camera module (114 errors) stays outside the core
until refactor-sheet-element.

## Risks / Trade-offs

- **[Many import paths change]** → `tsc` and the boundary rules catch any
  missed path, and each folder moves in its own commit.
- **[Analysis drift]** → A golden test records `analyze()` output for every
  sample page and the analysis test texts on all four presets, before the
  split. It must match after, except for the documented heading-width
  change on non-Terminal presets, which is listed in the test.

## Migration Plan

Code moves only. Stored data and contracts are unchanged, except that the
new `analysis.proto` is added. Reverting is a revert of the commits.

## Implementation Notes

Where the code differs from the decisions above, and why:

- **Moves:**
  - A codemod (`git mv`, then import rewrites checked by `tsc`) moved each
    folder in the planned order. `pnpm check` passed after each one.
  - The moves sit in one working tree, ready for one commit per folder or
    one commit, as the reviewer prefers.
  - `lib/tensor/` (the models' grid codec) and `lib/gen/` stay where they
    are.
- **Lens ids live in `page/spec.ts`** (`LENS_IDS`, `LensId`), next to
  `PRESET_IDS`. Settings (persist) and the element (render) can then name
  a lens without importing the analysis. Their names, hints, and painting
  stay in `analysis/lenses.ts`.
- **Analysis modules:**
  - `analyze.ts` holds `analyze()`, `Layout` lives in `metrics.ts` (to
    avoid an import cycle), and `compress.ts` holds compressibility.
  - `measure()` takes no config: no metric is configurable.
  - The heading width follows `spec.cols`. No recorded text changes on any
    preset, so the golden record is the one taken before the split; a
    separate test pins the rule on Pica, Elite, and Dense.
- **The report:**
  - The proto's finding message is `AnalysisFinding`, because `a4.v1.Finding`
    already exists in `model.proto`.
  - `report.ts` isn't exported from the analysis index. Tools import it
    directly, which keeps the proto out of the UI's first load.
- **Geometry:**
  - `page/geometry.ts` owns the paper size, `cellRect`, `cellAt`, `rowTop`,
    `fitScale`, `textureDensity`, and the pixel-ratio caps.
  - The caps stay two values (GPU 2, flat 3), so behavior is unchanged.
  - `PageSpec` extends geometry's `CellGrid`, so `spec` and `geometry` don't
    import each other.
- **The strict core:**
  - `tsconfig.core.json` uses `lib: ["ES2024"]`, not ES2023: archives use
    the store's page-name rules, which need `String.prototype.isWellFormed`.
  - The core may use web-standard globals: `TextEncoder`, `TextDecoder`,
    `Blob`, `Response`, `CompressionStream`, and `DecompressionStream`.
    `types/core/web.d.ts` declares only those, and the main config excludes
    it.
  - `PAGE_EXTENSION` moved to the store's `names.ts`, so archives don't pull
    in the OPFS store.
- **Boundary rules follow the code as it is:**
  - Models also depend on persist (consent uses revisions; the score
    schedule uses the scheduler type), the analysis (semantic units classify
    lines), and tensor.
  - Render depends on the analysis and tensor.
  - Workspace depends on archive and on `models/errors.ts`.
  - Components import folders through their `index.ts`. A dynamic import may
    load an entry point directly, which keeps the model registry's
    `import.meta.env.SSR` guard in `useModels`.
  - The render index registers the element with `defineSheetElement()`.
