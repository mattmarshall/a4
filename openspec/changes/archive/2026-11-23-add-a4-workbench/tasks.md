# Tasks

## 1. Scaffold and hosting

- [x] 1.1 Scaffold the vinext App Router app for Cloudflare Workers with pnpm and verify `pnpm install` completes with workerd built
- [x] 1.2 Configure the `a4` Worker with the `a4.marsh.build` custom domain in `cloudflare.config.ts` and verify `pnpm build` produces Worker output
- [x] 1.3 Add a not-found page and verify an unknown path returns 404 in the dev server

## 2. Page model

- [x] 2.1 Implement `PageSpec` presets (Terminal, Pica, Elite, Dense) with derived columns, rows, margins, and token ceiling, and verify unit tests assert 80x60, 62x58, 75x58, and 100x80
- [x] 2.2 Implement text normalization (tabs to two spaces, CRLF/CR to LF) and the visual-row model, and verify unit tests cover a 170-character line wrapping to 80/80/10

## 3. Analysis

- [x] 3.1 Implement the token heuristic and verify a unit test keeps 1,000 characters of prose between 180 and 320 tokens
- [x] 3.2 Implement fill, overflow, coverage, crowding, syntax overhead, repetition, duplicate lines, indentation, and narrative share, and verify unit tests for every density-analysis scenario
- [x] 3.3 Implement the verdict and findings with centralized thresholds, and verify unit tests for verdict order, the overflow finding, and the repeated-term finding
- [x] 3.4 Implement compressibility with `CompressionStream("deflate-raw")` and verify it reads below 10% for 50 repeated lines in the browser (verified with the same web API under Node's test runner; the browser shows live values in the sidebar)

## 4. Sheet and lenses

- [x] 4.1 Build the sheet (paper, margins, rulers, row numbers, grid toggle, overflow zone, zoom) and verify in the browser that an 80-character line does not wrap and an 81st character does
- [x] 4.2 Build the textarea-over-backdrop editor with Tab handling and paste normalization, and verify typing, selection, and undo in the browser
- [x] 4.3 Implement the lens segmenters (Ink, Syntax, Repetition, Structure, Tokens) and margin gauge, and verify unit tests for segmenters and visual alignment in the browser
- [x] 4.4 Implement autosave and restore through guarded `localStorage`, and verify a reload restores text, preset, and lens

## 5. Workbench, comparison, and guidance

- [x] 5.1 Build the metrics panel (capacity, metrics, verdict, findings, repeated terms) and verify it updates live while typing
- [x] 5.2 Build compare mode with per-metric deltas, better-value marking, swap, and copy A to B, and verify with the incident demo
- [x] 5.3 Write the welcome page, five templates, and the JSON and narrative incident samples, and verify a unit test that templates and the welcome page have zero overflow and the JSON sample is Noisy or Overflowing while the narrative sample is neither
- [x] 5.4 Add confirmation before replacing non-empty pages, and verify declining keeps the text
- [x] 5.5 Build the /why explainer (problem, approach, narrative practice) linked from the workbench, and verify it renders

## 6. Export

- [x] 6.1 Implement Copy and Download with slugged filenames, and verify a unit test for the slug rule
- [x] 6.2 Implement true-size print CSS (A4 page, 1 mm scale, ink only, no chrome or overflow), and verify with print preview (verified by applying the print stylesheet in the browser: 210 × 297 mm sheet, 16/15 mm margins, 60 rows over 267 mm, 3.708 mm type, chrome hidden)

## 7. Documentation and integration

- [x] 7.1 Write README (run, test, deploy) and docs/concept.md (problem, approach, narrative practice), and verify the commands in the README run as written (install, dev, test, typecheck, build, and start verified; deploy needs Cloudflare auth, see Workflow follow-up)
- [x] 7.2 Verify integration: `pnpm test`, `pnpm typecheck`, and `pnpm build` pass, and the dev server serves / and /why

## Workflow follow-up

- Run `pnpm run deploy` after authenticating with the Cloudflare account that owns `marsh.build`, then check https://a4.marsh.build.
- Archive this change once the deploy is verified, so the specs move to `openspec/specs/`.
