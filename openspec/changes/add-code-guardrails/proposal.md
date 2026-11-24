# Proposal

## Why

The review (`docs/tech-debt-review.md`, T1–T5, M8) found nothing that stops
debt from coming back:
- no linter or formatter;
- no import-boundary rules;
- no dead-export or CSS checks;
- `buf breaking` is configured but never run;
- no check that the heavy model libraries stay out of the first page load.

The refactors that follow move and split many files. Guardrails first mean
each refactor proves it kept the boundaries, instead of relying on review.

## What Changes

- **TypeScript flags with no current errors:** `noImplicitOverride`,
  `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, and
  `erasableSyntaxOnly`.
- **Flags that need small fixes:** `exactOptionalPropertyTypes` (13 errors in
  8 files) and `noImplicitReturns` (1).
- **Lint and format with Biome.**
  - A recommended rule set, plus rules against non-null assertions,
    unhandled promises, unused imports, and nested ternaries in markup.
  - Biome formats with the project's current style, so the first formatting
    commit is small.
- **Import boundaries with dependency-cruiser:**
  - `lib/` must not import `components/`, `app/`, or React.
  - `lib/` must not use the `@/` alias, so Node can run it.
  - No import cycles.
  - Plugin implementations must not be imported eagerly by UI code.
- **Dead code with knip:** unused files, exports, and dependencies.
- **CSS with stylelint:** duplicate selectors, `!important` outside print,
  and unknown custom properties.
- **Proto compatibility:** `buf breaking` against `main` runs in
  `proto:check`.
- **Bundle check:** after `pnpm build`, a script fails if the first-load
  client chunks contain `@anthropic-ai/sdk`, `@huggingface/transformers`, or
  `onnxruntime-web`.
- **One `pnpm lint` script, run in CI** before tests.

## Capabilities

### New Capabilities

### Modified Capabilities

(None: this changes tooling only. `skip_specs` is set.)

## Impact

- **Config:** `package.json` (dev dependencies and scripts), `tsconfig.json`,
  and new `biome.json`, `.dependency-cruiser.cjs`, `knip.json`, and
  `.stylelintrc.json`.
- **Scripts and CI:** `scripts/check-bundle.ts` and
  `.github/workflows/deploy.yml`.
- **Source:** small fixes for the new compiler flags, and whatever the first
  lint pass flags at error level. Rules that would churn many files start as
  warnings, and a later change turns them into errors folder by folder.

## Out of scope

- Fixing every warning: the refactors fix them as they touch each area.
- `noUncheckedIndexedAccess` (339 errors): enabled per folder in
  refactor-lib-layout.
- UI component tests: refactor-workspace-controller moves logic to plain
  TypeScript, where the existing test runner covers it.
