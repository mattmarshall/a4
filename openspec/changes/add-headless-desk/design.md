# Design: add-headless-desk

## Context

Most of what a headless desk needs already exists. See proposal.md for why
it's needed.

| Piece | Where | Notes |
| --- | --- | --- |
| Page geometry and layout | `lib/page/` | `layoutRows(text, cols)`, `rowsUsed(rows)` (through the last row with ink), `PRESETS.terminal` |
| Analysis | `lib/analysis/` | `analyze(text, spec)` and `toReport(analysis, spec)` → `a4.v1.AnalysisReport`, written "ready for a CI lint command". Runs without DOM or Node (`tsconfig.core.json`). |
| Finding and verdict copy | `components/analysis-copy.ts` | `describeFinding`, `VERDICT_LABEL`. Pure, with relative imports; its header expects "a CLI" to reuse it. |
| Folder walk | `lib/persist/store/folder.ts` | `walkFolder` (breadth-first, `.md`/`.mdc`, skips `SKIPPED_FOLDERS` and dot-folders except `.claude`, `.github`, `.cursor`, `.agents`, stops at `SCAN_ENTRY_LIMIT` = 20,000), `decodeStrict`, `MAX_FILE_BYTES` = 1 MiB |
| Context-file rule and sheet text | `lib/persist/folder/` | `isContextFile(path)` and `fileRows(raw)` in `scan.ts`; `toSheet(raw)` (tabs → two spaces, CRLF → LF) in `faithful.ts` |
| Node folder access | `lib/persist/folder/fs-node.ts` | `nodeFolderSource.open(dir)` → `FolderFs`, "for tests and a future CLI" |
| The host's fit loop | `lib/models/host.ts` `transform()` | Counts `layoutRows(result, cols).length`, every laid-out row including trailing blank ones |

**Constraints:**
- Import boundaries are enforced (`.dependency-cruiser.cjs`): each `lib/`
  folder is a layer with a fixed list of what it may import.
- Records that cross a process boundary are protobuf (`openspec/config.yaml`).
- The engine is `node >= 24`, and scripts run as `.ts` directly with Node's
  type stripping.

## Goals / Non-Goals

**Goals**
- One function that answers "does this page fit, and what's its verdict?"
  for any caller without a browser. It gives the same answer as the sheet.
- One definition of "fits", shared by the analysis, the folder view, the
  model host, and lint.
- A lint command that CI can trust:
  - deterministic output;
  - stable exit codes;
  - a protobuf report;
  - no writes;
  - no network.

**Non-Goals**
- A general Node runtime for A4: no headless storage, autosave, or models.
- Discovering files differently from the folder view. Lint and the folder
  view list the same files.
- Changing the analysis, its thresholds, or its copy.

## Decisions

### 1. The fit rule lives in `lib/page/`

Add `pageFit(text, spec) → { rowsUsed, pageRows, fits, overBy }` to
`lib/page/layout.ts`. It's `rowsUsed(layoutRows(text, spec.cols))` compared
with `spec.rows`. Callers:
- `ModelHost.transform` replaces its `layoutRows(...).length` with it;
- `scan.ts`'s `fileRows` uses it;
- the desk reads it.

The analysis keeps computing `metrics.rowsUsed` its own way. A test asserts
that `pageFit` and `analyze` agree on every golden text.

- **Why page:** fit is geometry. Page is the base layer every other layer
  already imports, so no new edge is needed.
- **Alternative: keep the host's count.** Rejected: today a Fit to page
  result ending in blank lines can count as over while the sheet shows it
  fits. That's the inconsistency `model-plugins` now spells out.
- **Alternative: put the rule in the analysis.** Rejected: the model host
  already imports the analysis, but the folder scan (persist) doesn't, and
  shouldn't have to.

### 2. A new `lib/desk/` layer, runtime-agnostic

`lib/desk/index.ts` exports:

- `judge(sheetText) → Judgment`: `{ fit, analysis, report }` on the Terminal
  preset.
- `judgeFile(raw) → Judgment`: `judge(toSheet(raw))`, the folder view's
  measurement.
- `outcomeOf(judgment, { strict }) → "pass" | "warn" | "fail"`:
  - fail when it doesn't fit;
  - with `strict`, also fail when the verdict is Noisy or Busy;
  - without `strict`, those verdicts are warn;
  - everything else passes.
- `lintFolder(fs, { exclude?, limit? }) → LintReport` and
  `lintFile(fs, path) → LintedFile`.

The desk takes a `FolderFs` and never imports `node:*`. The CLI supplies the
Node adapter and turns globs into the `exclude` predicate.

- **Allowed imports:** page, analysis, persist, and the generated protos. The
  layer rule says so, with a comment.
- **Alternative: build lint inside the CLI.** Rejected: letters and the
  mailroom (roadmap steps 2 and 3) need the same judgment from a server or an
  MCP tool. One facade keeps them on the same rule.
- **Alternative: also move the host's attempt loop into the desk.**
  Deferred: the desk needs the rule now, not the loop. In the mailroom the
  agent drives its own retries by calling the desk.

### 3. Lint measures exactly what the folder view measures

For each candidate path:
1. `fs.readBytes(path, { maxBytes: MAX_FILE_BYTES })`;
2. no bytes means the file is too large;
3. `decodeStrict` returning null means the text isn't UTF-8;
4. otherwise, `judgeFile(text)`.

Folder discovery is `walkFolder` plus `isContextFile`. These are the same
functions `scanFolder` uses, so both list the same files and skip the same
folders.

Exclusion is a predicate applied to each walked path. Excluded folders are
still walked, so they count toward the 20,000-entry limit. That keeps
`walkFolder` unchanged, and it's a footnote in the risks below.

### 4. Paths given as arguments

`a4 lint [path ...]`, where the default is `.`:
- **A directory:** lint it as a folder.
- **A file:** open its parent directory with the Node adapter and lint that
  one file. Its reported path is exactly what the user typed.
- **A missing path:** a usage error, exit 2.

Several paths produce one combined report, in argument order, and files
within a folder are sorted by path. That makes the output deterministic for
CI diffs.

### 5. The CLI: `cli/a4.ts`

- **Arguments:** `node:util` `parseArgs` with `strict: true` and
  positionals. The options are `--json`, `--strict`, `--exclude` (multiple),
  and `--help`. An unknown option or a missing value prints the usage and
  exits 2.
- **Globs:** `node:path` `matchesGlob`, run against the `/`-separated path
  relative to the folder.
- **Exit codes:** 0 pass, 1 lint failure, 2 usage or I/O error. A partial
  scan only adds a note.
- **Text output:** one line per file, then a summary:

  ```
  fail  74/60  Overflowing  AGENTS.md — 14 rows over: cut or split by purpose …
  warn  41/60  Noisy        .github/copilot-instructions.md — Syntax is 24% …
  pass  20/60  Balanced     CLAUDE.md
  3 files: 1 failed, 1 warning, 1 passed.
  ```

  The note after the dash is the file's most severe finding: critical, then
  warning, then info, in the analysis's order. Its title and detail come from
  `describeFinding`, so the words match the app. Unreadable files show their
  reason in place of rows and verdict.
- **JSON output:** `--json` prints only `toJsonString(LintReportSchema, ...)`
  on stdout. Notes go to stderr.
- **How it's run:** add a `"a4": "node cli/a4.ts"` script, so `pnpm a4 lint`
  works in this repository. Outside it, run `node <checkout>/cli/a4.ts lint`.
  A `bin` entry would do nothing for a private package that's never
  installed, so there isn't one.
- **Import boundaries:** `cli/` may import `lib/` through folder indexes, plus
  `lib/persist/folder/fs-node.ts` and `components/analysis-copy.ts`. It may
  import nothing else from `components/`. A new dependency-cruiser rule
  enforces this, and `depcruise` now scans `cli`.
- **Alternative: move the copy into `lib/`.** Rejected for now: it's UI
  wording with several UI importers, and its header already invites a CLI to
  reuse it.

### 6. `a4.v1.LintReport`

A new `proto/a4/v1/lint.proto` that imports `analysis.proto`:

```proto
message LintReport {
  string preset = 1;                 // "terminal"
  repeated LintedFile files = 2;
  bool partial = 3;                  // some folder stopped at the entry limit
  bool strict = 4;
}
message LintedFile {
  string path = 1;                   // as given, or relative to the folder
  LintOutcome outcome = 2;
  AnalysisReport report = 3;         // unset when unreadable
  Unreadable unreadable = 4;         // UNREADABLE_UNSPECIFIED when read
}
enum LintOutcome { LINT_OUTCOME_UNSPECIFIED = 0; LINT_OUTCOME_PASS = 1; LINT_OUTCOME_WARN = 2; LINT_OUTCOME_FAIL = 3; }
enum Unreadable { UNREADABLE_UNSPECIFIED = 0; UNREADABLE_TOO_LARGE = 1; UNREADABLE_NOT_UTF8 = 2; }
```

- **No text:** neither message has a text field. `AnalysisReport` already
  leaves the text out, except for repeated terms, which the spec allows.
- **Format:** proto3 JSON, with field names in lowerCamelCase as
  protobuf-es prints them.
- **Alternative: hand-written JSON or a zod schema.** Rejected: the project
  rule is protobuf for anything that crosses a process boundary, and
  `AnalysisReport` already exists.
- **Compatibility:** `buf breaking` passes, because the file is new.

### 7. Tests

- **Desk:** unit tests over both folder fixtures in
  `lib/persist/folder/testing/fixtures.ts` (`ADAPTERS`: the in-memory
  `browserFixture` and the temporary-directory `nodeFixture`). They check
  discovery (names, nested skills,
  skipped folders), exclusion, unreadable files, the partial limit (a small
  `limit`), outcomes in both modes, and that `judgeFile` equals the folder
  view's rows for tabs and CRLF.
- **`pageFit`:** layout tests, plus the golden agreement test.
- **Host:** add the trailing-blank-lines case to `host.test.ts`.
- **CLI:** `cli/a4.test.ts` runs `node cli/a4.ts` in a temporary directory,
  using `fs-node`'s fixtures helper. It checks:
  - exit codes 0, 1, and 2;
  - `--strict`;
  - `--exclude`;
  - that `--json` parses with `fromJsonString`;
  - that the JSON contains no test secret;
  - that the files' bytes and modification times are unchanged afterward.

  These run on a temporary directory built the way `nodeFixture` builds one.
  The test glob in `package.json` adds `cli/**/*.test.ts`, and knip adds
  `cli/*.ts` as entries.
- **No network:** the CLI loads no network module. A test runs it with
  `globalThis.fetch` replaced by a function that throws, through a small
  `--import` preload.

## Risks / Trade-offs

- **The fit rule changes what Fit to page accepts.** A result that ends in
  blank lines may now fit where it counted as over before. → This is the
  intended fix. It only ever loosens: any result that fit before still fits,
  because rows used never exceeds the laid-out row count.
- **Excluded folders still count toward the 20,000-entry limit.** → Partial
  scans are reported, not failed. A future change can prune excluded folders
  during the walk if a real repository hits the limit.
- **`path.matchesGlob` has varied across Node versions.** → It's present and
  unflagged in Node 24 and 26. The CLI tests cover `**` and single-segment
  globs, so a behavior change shows up in CI.
- **The CLI imports `components/analysis-copy.ts`, a UI module.** → It's pure
  and already loaded by Node tests. The new rule allows only that file from
  `components/`.
- **Running from a checkout limits adoption outside this repository.** →
  It's the intended first step. Publishing is out of scope and can follow
  once the report format settles.

## Migration Plan

No data migration. The only runtime behavior change is the host's fit rule,
which ships with the next deploy. Rolling back reverts the commit.

## Open Questions

- **Should `a4 lint` read options from a config file** (for example
  `a4.json`), so repositories don't repeat `--exclude`? This can wait for
  real use. Flags cover it now.

## Implementation Notes

Decisions that changed or were settled during the build:

- **Lint results carry their judgment.** `lintFile` returns a `LintResult`
  (`{ file: LintedFile, judgment: Judgment | null }`). `lintFolder` returns
  `{ results, partial }`, and `lintReport(results, { partial, strict })`
  builds the `a4.v1.LintReport`. `lintFailed` takes the results.
  - **Why:** the text report needs the analysis's own `Finding` values for
    `describeFinding`, and nothing converts a proto finding back.
- **One line per file shows the finding's title only,** such as "14 rows over
  the page". The detail sentence would wrap every line. The JSON report keeps
  the full finding.
- **A folder argument prefixes its files' paths.** `a4 lint packages/api`
  reports `packages/api/AGENTS.md`, so every path opens from the current
  directory. `--exclude` globs still match the folder-relative path, as the
  spec says. `lint.proto` documents this.
- **Limits come from the code, not the copy.** The desk re-exports
  `MAX_FILE_BYTES` and `SCAN_ENTRY_LIMIT`, and the CLI formats them with
  `formatByteLimit` and `ENGLISH.count`. The partial-scan note goes to stderr
  in both output modes, so `--json` stdout stays pure.
- **Three import rules guard the boundaries:**
  - `desk-no-runtime`: the desk imports no Node built-ins. A probe import of
    `node:fs` was rejected.
  - `cli-copy-only`: from `components/`, `cli/` imports only
    `analysis-copy.ts`.
  - `cli-through-index`: `cli/` imports `lib/` through folder indexes, plus
    `fs-node.ts`.
- **Paths sort by code unit,** `Number(a > b) - Number(a < b)`, rather than
  by locale (Biome flags the nested ternary). The order is the same on every
  machine.
- **The no-network test uses a real preload.** It makes `fetch`, `http`,
  `https`, `net`, and `tls` throw and calls `syncBuiltinESMExports()`. A probe
  confirmed it blocks both `fetch` and a named `node:http` import.
- **`pnpm a4 lint --json` is clean JSON.** pnpm 12 prints its `$ node
  cli/a4.ts` banner to stderr.
- **The self-lint matches the proposal.** On this repository, `pnpm a4 lint`
  fails all 12 generated OpenSpec skills (215–527 rows). With `--exclude
  '.claude/skills/**' --exclude '.agents/skills/**'`, it finds no context
  files and exits 0.
- **`openspec/config.yaml`'s context also names consented model calls** as a
  way text leaves the device. Fit to page already did this, and the context
  had said only user exports.
