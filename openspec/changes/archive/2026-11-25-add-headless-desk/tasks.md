# Tasks

## 1. One fit rule

- [x] 1.1 Add `pageFit(text, spec) → { rowsUsed, pageRows, fits, overBy }` to `lib/page/layout.ts`, exported from `lib/page`. Add layout tests where exactly 60 rows fits, 63 rows is over by 3, and 58 rows followed by 5 blank lines uses 58 and fits. Verify they pass with `pnpm test`
- [x] 1.2 Add a golden agreement test in `lib/analysis/` checking that `pageFit(text, spec).rowsUsed` equals `analyze(text, spec).metrics.rowsUsed` for every analysis test text on every preset. Verify it passes
- [x] 1.3 Make `ModelHost.transform` decide `rowsUsed`, `fits`, and `overBy` with `pageFit`. Add a `host.test.ts` case where a Transform returns 58 rows plus 4 blank lines and fits on the first attempt. Verify the new case and all existing host and fit-job tests pass
- [x] 1.4 Make `fileRows` in `lib/persist/folder/scan.ts` use `pageFit`. Verify the scan tests pass unchanged

## 2. The lint report message

- [x] 2.1 Add `proto/a4/v1/lint.proto` (`LintReport`, `LintedFile`, `LintOutcome`, `Unreadable`, importing `analysis.proto`) as in design decision 6, with no field for page text. Run `pnpm proto`, commit `lib/gen/a4/v1/lint_pb.*`, and verify `pnpm proto:check` passes (buf lint, the generated-file check, and buf breaking)

## 3. The desk

- [x] 3.1 Create `lib/desk/` with `index.ts` exporting `judge`, `judgeFile`, and `outcomeOf` (design decision 2), and add a `desk` layer to `.dependency-cruiser.cjs` allowing page, analysis, persist, and gen, with a comment saying why. Add tests that:
  - `judgeFile` gives the same rows used as `fileRows` for a file with tabs and CRLF;
  - `outcomeOf` returns fail for an overflowing page in both modes;
  - with `strict`, it returns fail for Noisy and Busy pages; without it, warn;
  - it returns pass for Empty, Light, and Balanced pages.

  Verify `pnpm test` and `pnpm lint:deps` pass
- [x] 3.2 Add `lintFile(fs, path) → LintedFile`. On every adapter in `lib/persist/folder/testing/fixtures.ts`, add tests where a 1,048,577-byte file is failed as too large, a file with invalid UTF-8 is failed as not UTF-8, and a file containing "token: sk-test-123" produces a report whose protobuf JSON doesn't contain "sk-test-123". Verify they pass
- [x] 3.3 Add `lintFolder(fs, { exclude, limit }) → LintReport` using `walkFolder` and `isContextFile`. Add adapter tests that:
  - it lists `AGENTS.md` and `.claude/skills/review/SKILL.md` and not `README.md` or `node_modules/pkg/AGENTS.md`;
  - an `exclude` predicate drops the skill;
  - a small `limit` sets `partial` without failing any file;
  - files come back sorted by path;
  - a folder with no context files returns an empty, passing report.

  Verify they pass

## 4. The `a4` command

- [x] 4.1 Write `cli/a4.ts` (design decisions 4 and 5), and add the wiring:
  - **The command:**
    - `parseArgs` with `--json`, `--strict`, repeatable `--exclude`, and `--help`;
    - positional paths, defaulting to `.`;
    - folder and file arguments, with a missing path as exit 2;
    - `--exclude` matched with `path.matchesGlob`;
    - text lines using `VERDICT_LABEL` and the most severe finding through `describeFinding`, then a summary;
    - `--json` printing only `toJsonString(LintReportSchema, …)`;
    - exit codes 0, 1, and 2.
  - **The wiring:**
    - the `a4` script in `package.json`;
    - `cli/**/*.test.ts` in the test glob;
    - `cli/*.ts` as a knip entry;
    - `cli` added to the `lint:deps` scan;
    - a dependency-cruiser rule letting `cli/` import from `components/` only `analysis-copy.ts`.

  Verify `pnpm lint` passes
- [x] 4.2 Add `cli/a4.test.ts`, which runs `node cli/a4.ts` in a temporary directory. Check:
  - a 74-row `AGENTS.md` prints `74/60`, "Overflowing", and the 14-rows-over finding, and exits 1;
  - all-fitting files exit 0;
  - a Noisy file exits 0 without `--strict` and 1 with it;
  - `--exclude '.claude/skills/**'` skips the skill;
  - a file argument outside any context-file name is checked;
  - a missing path and `--fast` each exit 2 and print the usage;
  - `--help` exits 0;
  - `--json` output parses with `fromJsonString(LintReportSchema, …)` and doesn't contain a planted secret;
  - every file's bytes and modification time are unchanged afterward.

  Verify the tests pass
- [x] 4.3 Add a no-network test: run the CLI with an `--import` preload that makes `fetch`, `http.request`, `https.request`, and `net.connect` throw, and check that the lint still succeeds with the expected exit code. Verify it passes
- [x] 4.4 Add a "Page lint" section to the README covering:
  - `pnpm a4 lint` and `node <checkout>/cli/a4.ts lint`;
  - which files it checks;
  - `--strict`, `--exclude`, and `--json` (the `a4.v1.LintReport` message);
  - the exit codes;
  - that it reads only and never touches the network.

  Add the `a4` script to the Scripts list, and run each documented command on a fixture folder to verify it behaves as written

## 5. Docs and context

- [x] 5.1 Update the docs:
  - `docs/concept.md`: mark the "Page lint" next step as shipped, linking the README section;
  - `docs/platform.md`: in roadmap step 1, say the headless desk and `a4 lint` exist;
  - `openspec/config.yaml`: change the context to say analysis runs on the device, in the browser or the local CLI.

  Verify with `grep -n "Page lint" docs/concept.md docs/platform.md` and by reading the config's context
- [x] 5.2 Add an Implementation Notes section to `design.md` recording any decision that changed during the build. Verify it matches the code

## 6. Integration

- [x] 6.1 Run `pnpm check` (lint, tests, typecheck, proto check, build, bundle check, element build). Verify it passes, and that the bundle check still keeps `lib/desk` and `cli` out of the home page's chunks
- [x] 6.2 Run `pnpm a4 lint` on this repository. Verify it reports the 12 generated OpenSpec `SKILL.md` files as failing (215–527 rows) and exits 1. Then verify that with `--exclude '.claude/skills/**' --exclude '.agents/skills/**'` it says no context files were found and exits 0
- [x] 6.3 Validate the change with `openspec validate add-headless-desk --strict`. Verify it passes

## Workflow follow-up

- After the change is committed and deployed, sync the delta specs (`page-lint` new; `density-analysis` and `model-plugins` modified) and archive the change.
