# Proposal: add-headless-desk

## Why

A4's judgment of a page only runs in the browser, so it can't check the
context files a repository already ships: `AGENTS.md`, `CLAUDE.md`,
`SKILL.md`, and the rest. Those files grow unseen until someone opens them.
This repository is an example: its 12 context files are all generated
OpenSpec skills, and they lay out to 215–527 rows on a 60-row page.

`docs/concept.md` lists "Page lint" as a next step, and `docs/platform.md`
makes a headless desk step 1 of the platform roadmap. Letters and the
mailroom (steps 2 and 3) need the same thing: a desk that judges a page
without a browser.

## What Changes

- **A headless desk** (`lib/desk/`): one facade that non-UI callers use to
  judge a page. Given a page's text, it returns:
  - the fit: rows used, page rows, whether it fits, and by how much it's
    over;
  - the verdict and findings;
  - the report as `a4.v1.AnalysisReport`.

  It runs anywhere the pure core runs, with no DOM. It also lints a folder:
  it finds context files the same way the folder view does and judges each
  one.
- **One fit rule.** "Fits" means rows used, counted through the last row
  with ink, is at most the page's rows. This is the rule the analysis and the
  folder view already use. The model host now uses it too.
  - Today the host counts every laid-out row, including trailing blank ones.
    A Fit to page result that ends in blank lines can therefore count as
    over when the sheet shows it fits.
  - The rule lives in `lib/page/` beside the layout.
- **An `a4 lint` command** (`cli/a4.ts`, run as `pnpm a4 lint` here or
  `node cli/a4.ts lint` from a checkout).
  - Lints a folder (default: the current directory) or the files given.
  - Prints one line per file: rows used out of 60, the verdict, and the top
    finding.
  - Exits non-zero when a file doesn't fit.
  - `--strict` also fails Noisy and Busy pages.
  - `--exclude <glob>` (repeatable) skips generated files.
  - `--json` prints an `a4.v1.LintReport` with each file's
    `AnalysisReport`, and never the text.
  - It reads files and never writes them, and it makes no network request.
- **A new `a4.v1.LintReport` message** in `proto/a4/v1/lint.proto`.
- **Docs:** a Page lint section in the README. Concept.md's next steps and
  platform.md's roadmap now say this step exists. `openspec/config.yaml`'s
  context says analysis runs on the device, in the browser or the local CLI.

The Node folder adapter (`lib/persist/folder/fs-node.ts`) already exists,
written for tests and "a future CLI". This change makes it the CLI's folder
access, read-only.

## Capabilities

### New Capabilities

- `page-lint`: the command-line check of a repository's context files
  against the page. It covers:
  - which files it checks, and that they're measured as the folder view
    measures them;
  - pass and fail, exit codes, and `--strict`;
  - exclusions;
  - unreadable and partial scans;
  - the JSON report;
  - that it never writes or sends anything.

### Modified Capabilities

- `density-analysis`: "Live analysis on device" allows the local command
  line as well as the browser. Analysis still never sends page text over the
  network.
- `model-plugins`: "Host-enforced fit" counts rows used through the last
  row with ink, the same rule as the analysis, so trailing blank rows don't
  make a result overflow.

## Impact

- **New code:**
  - `lib/desk/` (facade and folder lint, a new layer that may use page,
    analysis, and persist);
  - `cli/a4.ts`;
  - `proto/a4/v1/lint.proto` and its generated `lib/gen/a4/v1/lint_pb.*`.
- **Changed code:**
  - `lib/page/layout.ts` (the fit rule);
  - `lib/models/host.ts` (uses it);
  - `package.json` (`a4` script, test glob);
  - `.dependency-cruiser.cjs` (desk layer, `cli` scanned);
  - `knip.json` (`cli/*.ts` entry).
- **Dependencies:** none. Uses `node:fs`, `node:path` (`matchesGlob`), and
  `node:util` (`parseArgs`), within the declared `node >= 24`.
- **Behavior change:** Fit to page may now accept a result that ends in blank
  lines and was counted as over before. No stored data changes.

## Out of Scope

- Publishing `a4` to npm or installing it globally. It runs from a checkout
  of this repository.
- Any command that sends page text off the device, such as a CLI Fit to page.
  The CLI makes no network request.
- Rewriting or fixing files. Lint only reads.
- Presets other than Terminal. Context files are judged on the canonical
  80 × 60 page, as the folder view does.
- Honoring `.gitignore`. The scan skips the same folders as the folder view,
  plus `--exclude` globs.
- Running `a4 lint` on this repository in CI. Its only context files are
  generated OpenSpec skills.
- Moving the model host's attempt loop into the desk. The desk owns the fit
  rule. A loop the desk drives can follow when letters need one.
- Wide characters (CJK, emoji), which remain a known limitation of the grid.
