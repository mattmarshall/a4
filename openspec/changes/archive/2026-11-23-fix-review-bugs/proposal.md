# Proposal

## Why

The technical debt review (`docs/tech-debt-review.md`) found real bugs, not
only debt.
- Two are visible today: B1, now fixed and deployed, and B20.
- Several can lose or orphan edits in rare races.
- Others break promised behavior: a 3D sheet that freezes, model calls that
  hang forever, and analysis bars that contradict the findings.

These should ship, each with a regression test, before the refactors that
follow. Otherwise the refactors would have to preserve broken behavior, or
fix it silently.

## What Changes

The B-numbers refer to the review.

- **Failed writes leave nothing behind (B21):** a create, rename, trash, or restore whose write fails no longer leaves an empty page in the library or an empty file in the folder.
- **Saved text is exact (B2):** a library page whose text starts with a
  byte-order mark, or holds a lone surrogate, no longer conflicts on every
  save. The store keeps the text exactly, or refuses text it can't store.
- **No lost edits:**
  - **B3:** keys typed while a file's text is copied to the library are
    kept as a draft.
  - **B5:** a draft left by a failed save in this tab is merged when the
    page is reopened, not overwritten.
- **Folders:**
  - **B4:** picking the same folder again reuses its identity, so locks and
    drafts stay shared across tabs.
  - **B7:** a remembered folder file in Compare slot B survives a reload.
  - **B12:** "Save to folder…" saves the page it names, even if the slot
    changed.
- **Opening pages (B6):** each slot runs one open at a time. Fast mode
  switches and Fit to page can no longer leave orphaned sessions.
- **Models:**
  - **B8:** a crashed or failing plugin worker ends its pending calls with
    an error, and is replaced on the next call.
  - **B16:** model cards are frozen at registration, so consent can't be
    turned off by changing a card.
  - **B17:** the host validates finding spans and plane shapes, and keys
    planes by plugin and plane name.
- **3D:**
  - **B9:** after a lost GPU device, a sheet retries 3D once, then renders
    flat and reports it.
  - **B18:** reconnecting a sheet while its renderer is being created no
    longer leaks a renderer.
- **Presets (B10):** an unknown preset name such as "toString" falls back to
  Terminal.
- **Page names (B11):** sanitized page names are always valid, so zip
  import and legacy migration can't abort partway.
- **Semantic lens (B13):** turning it on scores the page once, not twice.
- **Fit to page (B14):** a running rewrite continues while the Models
  section or the inspector is hidden, or focus mode is on. Its progress and
  Cancel stay reachable in the top bar.
- **Errors (B15):**
  - Cmd/Ctrl+S reports a failed save instead of "Saved".
  - Failed open, duplicate, restore, and delete actions show a message
    instead of failing silently.
- **Analysis (B19):** the verdict, the findings, and the metric bars all
  read one set of signals, so they can't contradict each other.
- **Header (B20):** a folder file's path in the top bar is readable in dark
  mode (it used the paper's ink color).

## Capabilities

### New Capabilities

### Modified Capabilities
- `page-storage`: page text round-trips exactly, including a leading
  byte-order mark; text that can't be stored is refused.
- `autosave`: edits typed while text moves to a copy are kept; a draft from
  this tab is merged when its page is reopened.
- `folder-pages`: a folder keeps its identity when picked again; remembered
  files reopen in either slot; Save to folder saves the page it names.
- `model-plugins`: failed plugins end their calls; cards are fixed at
  registration; plugin results are validated.
- `paper-view`: recovery after a lost GPU device.
- `semantic-repetition`: one score per lens activation or edit pause.
- `fit-to-page`: a rewrite continues while its panel is hidden.
- `sheet-editor`: saving with Cmd/Ctrl+S reports failures.
- `page-library`: imported and migrated names are always valid; failed
  library actions are reported.
- `page-comparison`: switching modes quickly leaves the slots consistent.
- `density-analysis`: the metric bars agree with the verdict and findings.

## Impact

- **Storage, autosave, and folders:** `lib/store/` (opfs, key-value, names,
  refs, contract tests), `lib/autosave/` (session, bootstrap), and
  `lib/folder/` (connection).
- **Models:** `lib/models/` (host, worker-transport).
- **3D:** `lib/paper/` (gpu, renderer) and `lib/element/a4-sheet.ts`.
- **Presets and analysis:** `lib/page-spec.ts`, and `lib/analyze.ts` with
  `components/MetricsPanel.tsx`.
- **UI:** `components/` (useLibrary, Workbench, FitToPage, LibraryPanel) and
  `app/globals.css`.
- **New small, testable modules:**
  - `lib/workspace/slot-requests.ts`
  - `lib/models/fit/job.ts`
  - `lib/models/semantic/schedule.ts`
  - `lib/workspace/errors.ts`
- **No changes to:** stored formats, the proto contracts, the published
  element contract, or the deploy.

## Out of scope

- Restructuring `useLibrary` and the Workbench (refactor-workspace-controller).
- Typed contracts beyond what a fix needs (refactor-typed-contracts).
- Linting and tooling (add-code-guardrails).
- CSS reorganization beyond B20 (refactor-styles).
