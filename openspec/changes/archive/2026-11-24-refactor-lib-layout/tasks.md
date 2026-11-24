# Tasks

## 1. Golden tests first

- [x] 1.1 Record a golden file of `analyze()` output (metrics, verdict, finding data) for every sample page and analysis test text, on all four presets. Verify that the test passes on the current code

## 2. Folders

- [x] 2.1 Move to `lib/page/` (spec, layout, chars, geometry) with a public `index.ts`, and update imports. Verify that `pnpm check`, `pnpm lint`, and the golden test pass
- [x] 2.2 Split the analysis into `lib/analysis/` (config, classify, metrics, signals, assess, report, index) with `AnalysisConfig` and a heading width that follows `spec.cols`. Verify that the golden test passes, with the non-Terminal heading changes listed
- [x] 2.3 Move `lib/archive/`, `lib/content/`, and `lib/persist/` (store, autosave, folder, settings), and `lib/render/` (element, paper), with public `index.ts` files, and update imports. Verify that `pnpm check` and `pnpm lint` pass after each move

## 3. Contracts and config

- [x] 3.1 Add `proto/a4/v1/analysis.proto` and `toReport()`. Verify with a round-trip test and `pnpm proto:check`
- [x] 3.2 Add `tsconfig.core.json` (`noUncheckedIndexedAccess`, ES2023, no DOM or Node types) to `pnpm typecheck`, and fix its errors. Verify that `pnpm typecheck` passes and a planted `document` use in `lib/page` fails
- [x] 3.3 Rewrite the dependency-cruiser rules for the new layout, with components importing only `index.ts` files. Verify that `pnpm lint` passes and a planted deep import fails

## 4. Integration

- [x] 4.1 Run `pnpm check`, `pnpm lint`, and `openspec validate refactor-lib-layout --strict`, and check in the browser that the metrics, lenses, and samples look unchanged on Terminal and Dense

## Workflow follow-up

- Commit and push to deploy, then archive this change.
