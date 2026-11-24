# Design

## Context

- **Toolchain:** TypeScript 7 (the native compiler), Vite 8 (rolldown),
  Node 26 for tests, and Tailwind v4 (CSS via PostCSS). Generated protobuf
  code lives in `lib/gen/`.
- **What CI runs today:** `pnpm test`, `typecheck`, `proto:check`, and
  `build`.
- **Measured compiler-flag cost** (by the review):
  - `noImplicitOverride`, `noFallthroughCasesInSwitch`,
    `verbatimModuleSyntax`, and `erasableSyntaxOnly`: 0 errors.
  - `exactOptionalPropertyTypes`: 13 errors.
  - `noImplicitReturns`: 1 error.
  - `noUncheckedIndexedAccess`: 339 errors.

## Goals / Non-Goals

**Goals:**
- Every guardrail runs locally with one command and in CI.
- The first pass lands without a large rewrite.
- The boundary rules describe the target architecture, so later refactors
  can tighten them.

**Non-Goals:**
- Fixing every existing lint warning.
- Type-aware lint rules that depend on the JavaScript compiler API.

## Decisions

### 1. Biome, not typescript-eslint

typescript-eslint's type-aware rules use the TypeScript compiler API, which
the native TypeScript 7 compiler doesn't expose the same way. Biome needs no
compiler API, lints and formats in one tool, and is fast enough to run on
every save.

- **What the type-aware rules covered:**
  - Exhaustive switches: an `assertNever` helper plus
    `noFallthroughCasesInSwitch`, adopted in refactor-typed-contracts.
  - Unnecessary casts: caught in review, and counted by a script in the
    review metrics.
- **Rule set:** Biome recommended, plus `noNonNullAssertion`,
  `noFloatingPromises` (where available, else `useAwait` patterns),
  `noUnusedImports`, `useImportType`, and `noNestedTernary` (warn).
- **Formatting:** match the current code (2 spaces, double quotes,
  semicolons, a line width of 120). Apply it in its own commit, so later
  diffs stay readable.

### 2. dependency-cruiser for boundaries

The rules are written against today's folders, and refactor-lib-layout
rewrites them for the new layout.
- `lib/**` must not depend on `components/**`, `app/**`, `react`, or `@/*`.
- No cycles.
- `components/**` must not import `lib/models/fit/adapter.ts`,
  `lib/models/semantic/worker.ts`, or any heavy dependency directly. The
  registry's dynamic imports are allowed.
- `lib/store/**`, `lib/autosave/**`, and `lib/folder/**` must not import
  `lib/models/**` or `lib/paper/**`.

### 3. knip, stylelint, and buf breaking

- **knip:** entries are the app routes, `scripts/*.ts`, the test files, and
  the worker entry. It ignores `lib/gen/**`, and starts as a report, failing
  only on unused files and dependencies.
- **stylelint:** `stylelint-config-standard`, with Tailwind's at-rules
  allowed, `no-duplicate-selectors`, and `declaration-no-important` except
  inside `@media print`. Existing violations become warnings until
  refactor-styles.
- **buf breaking:** `buf breaking --against '.git#branch=main'`, skipped
  with a clear message when `main` isn't available (a shallow clone in CI
  fetches it first).

### 4. Bundle check

`scripts/check-bundle.ts` reads the client build's manifest (or the HTML
entry's module graph), collects the chunks the home route loads before
interaction, and fails if any contains the markers of the heavy dependencies
(`@anthropic-ai/sdk`, `@huggingface/transformers`, `onnxruntime-web`). It
runs after `pnpm build` in `pnpm check`.

## Risks / Trade-offs

- **[Biome misses some type-aware checks]** → Covered by compiler flags,
  `assertNever`, and the review metrics script. Revisit when
  typescript-eslint supports TypeScript 7.
- **[Formatting churn]** → One mechanical commit, with no other changes in
  it.
- **[Boundary rules block a needed import]** → Rules can be adjusted in the
  same change that needs it, with a comment explaining why.

## Migration Plan

Dev dependencies only. CI gains a lint step. Reverting removes the configs
and scripts.
