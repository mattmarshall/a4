# Design

## Context

- **Source:** `docs/tech-debt-review.md` lists each bug (B1–B19) with file
  and line. B20 was found while confirming the B1 fix on the live site.
- **Already shipped:** B1, in commit `31613d8`. This change adds its
  regression check.
- **Where the bugs are:** most are in modules with unit tests (store,
  autosave, folder, models, analysis). The UI bugs (B6, B7, B12–B15) live in
  `components/useLibrary.ts` and `components/Workbench.tsx`, which no test
  runs today.
- **Approach:** move each UI bug's logic into a small plain-TS module with
  tests, instead of adding a React test harness. Those modules become the
  seeds of refactor-workspace-controller.

## Goals / Non-Goals

**Goals:**
- A failing regression test first, then the fix, for every bug that can be
  tested in Node.
- A browser check for every visible one.
- No change to stored formats, proto contracts, or the element contract.

**Non-Goals:**
- Restructuring `useLibrary` or the Workbench beyond extracting the pieces
  each fix needs.

## Decisions

### Storage (B2, B11)

- **OPFS reads exact text:**
  - It decodes with `new TextDecoder("utf-8", { ignoreBOM: true })` from
    `arrayBuffer()`, not `file.text()`, so a leading U+FEFF survives.
  - Every backend checks `text.isWellFormed()` on create and write, and
    refuses otherwise with a new `invalid-text` code (`InvalidTextError`).
    Sessions surface it as an error; it isn't retried.
  - The contract suite gains BOM and lone-surrogate cases, so every backend
    is held to it.
- **Names:** `sanitizePageName` strips leading dots and spaces in a loop,
  then returns `parsePageName(result)`, falling back to the default name.
  No `as PageName` remains outside the parser. A test feeds
  `". .x"`, `" . "`, and `"...."`.

### Failed first writes (B21, found while verifying B15)

- **The bug:** OPFS create, rename, trash, and restore, and folder create,
  all create the file before writing it. If that write failed (for example,
  with storage full), an empty page appeared in the library, or an empty
  file in the user's folder.
- **The fix:** a shared `createFile(dir, name, text)` removes the new file if
  its first write fails. Folder create does the same.
- **Tests:** a fake-volume `failWritable` switch covers create, rename,
  trash, and restore.

### Autosave (B3, B5)

- **B3:** in copy-out relocation, after `copies.create(target, text)`:
  - If `#text !== text`, the session keeps a journal entry for the new
    copy's name (journal entries are keyed by id; the copy lives in the
    library journal, which the caller passes as `copiesJournal`).
  - It reports `pendingText` in the `moved` event, and the caller's
    library session saves it.
  - The test types during a slow `create`. It asserts that the library
    journal holds the latest text until the copy is saved, and that the
    copy ends with it.
- **B5:** when a session is constructed with `journal.get(id)` present for
  this tab, and that draft differs from the stored text, the session starts
  from the draft. It journals and schedules a save; a stale base surfaces
  as a conflict copy, as usual. The test is a failed save, then dispose,
  then reopen in the same tab.

### Folders (B4, B7, B12)

- **B4:** before minting a new id, `FolderConnection.open(handle)` asks the
  handle store for every stored `(id, handle)` pair and reuses the id whose
  handle `isSameEntry`.
  - `HandleStore` gains `entries()`.
  - The fake models `isSameEntry` by identity, which matches what a re-pick
    returns in tests.
- **B7:** the boot pending-file logic applies to both slots.
  - At boot, a remembered file in B is kept in `a4:open:b`.
  - `ensureSlotB` opens a library fallback with `remember: false` while the
    folder is connecting.
  - `onConnected` reopens B's file only if B still shows that fallback.
  - The decision is a pure function, `pendingReopen(pending, current)` in
    `lib/workspace/pending.ts`, with tests.
- **B12:** the save request carries a `LibraryRef`, and
  `saveToFolder(ref, path)` reads that page's text, not the slot's.

### Opening pages (B6)

- `lib/workspace/slot-requests.ts` holds `SlotRequests`: "last request wins"
  per slot. Each request to change a slot takes a ticket, which goes stale
  when a newer request for that slot begins.
- `openInSlot` checks its ticket after each `await`, disposes what it built
  if superseded, and disposes whatever the slot holds at that moment (not a
  value read before the await).
- `ensureSlotB` takes a ticket before loading the list. `closeSlotB` takes
  one, so it supersedes a pending open, and only clears B if B still holds
  what it disposed.
- **Why tickets rather than a strict per-slot queue:** commands such as
  trash, follow-copy, and reconnect open pages from inside other slot work,
  which a queue would deadlock.
- The mode effect stays. Tickets make its open and close calls safe in any
  order, and the Workbench split in refactor-workspace-controller turns it
  into a command.
- Tests cover superseded requests and overlapping async opens.

### Models (B8, B16, B17)

- **B8 (transport):**
  - `connectPort` accepts an optional `onFailure` hook. A `fromWorker` port
    adapter wires `error` and `messageerror` to fail every pending reply
    with `unavailable`, and marks the port closed.
  - The host evicts a client whose port closed, so the next call starts a
    new worker.
  - The test is a fake port that emits `error` mid-stream.
- **B16:** `register` stores `clone(ModelCardSchema, card)`, deep-frozen,
  and derives a private `policy` (`egress: "none" | { host }`). All
  decisions read `policy`, and `list()` returns frozen clones. The test
  mutates the original card after registration.
- **B17:** `checkResult` validates finding spans against the text length,
  plane depth == 1, and unique plane names. The Workbench keys planes by
  `${pluginId}/${plane.name}`.

### 3D (B9, B18)

- **B9:**
  - `getGpuDevice` gains `onLost(callback)`, and `PaperRenderer` exposes
    `lost: Promise<void>`.
  - The element moves to `lost` and tries one recreation. On failure it
    sets `#gpu = "unavailable"` and re-runs `#applyRender()`, which renders
    flat and dispatches `a4-render` "flat".
  - Checked in the browser by calling `device.destroy()` through a debug
    hook available in dev only.
- **B18:** creation uses a token. A result whose token no longer matches is
  destroyed on arrival.

### Presets (B10)

`isPresetId` uses `Object.hasOwn(PRESETS, value)`. A test covers
`"toString"`, `"constructor"`, and `"__proto__"`, and the element falls back
to Terminal.

### Semantic lens (B13)

- `lib/models/semantic/schedule.ts` holds `ScoreSchedule`, which hands out
  request ids, debounces at 1,500 ms, and drops results whose id or text is
  stale.
- The Workbench effect becomes a call into it, which removes the suppressed
  dependency list.
- The test drives a fake scheduler: turning the lens on scores once in
  3,000 ms.

### Fit to page (B14)

- `lib/models/fit/job.ts` holds `FitJob`, a state machine (`idle`,
  `confirm`, `running {attempt, characters}`, `done`, `failed`) that owns
  the `AbortController`. It is created once by the Workbench.
- `FitToPage` renders the job's state.
- A small top-bar chip shows progress and Cancel while it runs, whatever
  the inspector state.
- Tests cover the state transitions and abort.

### Errors (B15)

- `lib/workspace/errors.ts` holds `describeError(error)` (store codes and
  model codes to plain English) and `runReported(promise, notify, verb)`.
- The `void lib.x()` calls in the Workbench go through `runReported`.
- Cmd/Ctrl+S awaits `flushAll()` and reads each slot's status after it, so
  it shows "Saved" only when every status is `saved`.

### Analysis (B19)

- **`signals(metrics)` in `lib/analyze.ts`** returns one record per metric:
  `{ value: number | null, tone: "ok" | "warn" | "bad" | "na" }`, with the
  existing thresholds and the narrative gate applied once.
- **`verdictFor`, `findingsFor`, and the MetricsPanel bars** all read it.
- **Tests:**
  - A 3-line key-value page is `na` for narrative, with no narrative
    finding.
  - Every metric whose bar is warn or bad has a matching finding.

### Header path color (B20)

`.file-path` uses `var(--text)`, not `var(--ink)` (the paper's ink color).
Checked in the browser in both themes.

## Risks / Trade-offs

- **[Refusing lone surrogates could block saving text that was saveable
  before]** → Such text was silently changed on save before (U+FFFD), and
  then conflicted forever. A clear error is better. The sheet's input
  produces well-formed text, so in practice only paste or programmatic
  input could hit it.
- **[B5 changes what a reopened page shows]** → It shows text the author
  typed in this tab that never saved. That's the autosave promise. The
  existing conflict path still protects against a stale base.
- **[More small modules before the big refactor]** → They are exactly the
  modules that refactor reuses (`SlotRequests`, `FitJob`, `ScoreSchedule`,
  `describeError`, pending reopen).

## Migration Plan

- Stored data needs no migration. Pages with a BOM that conflicted before
  save normally after this change.
- Ships through the normal deploy. Reverting restores the old behavior with
  no data change.
