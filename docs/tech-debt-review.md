# Technical debt review (2026-11-23)

A review of every source file, done before the next iteration. It focuses on
three things:

- **Encapsulation:** each piece owns its state and exposes a small API.
- **Decoupling:** pieces depend on interfaces, not on each other's internals.
- **Strong typing:** illegal states don't compile.

Five reviewers each read one area in full: the UI layer; storage, autosave,
and folders; the `<a4-sheet>` element and 3D paper; models, the tensor, and
the protos; and the page model, analysis, CSS, and tooling. Their findings
were then checked against the code.

**Verification labels:**
- **Reproduced:** shown with a failing script or in the browser.
- **Confirmed:** read in the code at the cited lines.
- **Plausible:** reasoned from the code, not yet run.

## Status (2026-11-24)

**Every finding is done.**
- All eight planned changes shipped to a4.marsh.build and are archived under
  `openspec/changes/archive/`, each with every task checked off.
- A ninth change, `fix-review-leftovers`, closed the seven findings the plan
  never assigned or a change covered only in part.
- The test count went from 262 to 570.

| Phase | Change | Commit | Findings |
| --- | --- | --- | --- |
| 1 | `fix-review-bugs` | `e6e755e` | B1–B21 |
| 2 | `add-code-guardrails` | `6e90f23` | T1, T2, T4, T5, M8 |
| 3 | `refactor-typed-contracts` | `864d96f` | S1–S4, E1, E2, E5, E6, A1, A2, A6, U6, U7, M6, M7, M11 |
| 4 | `refactor-workspace-controller` | `c699394` | S8–S10, U1–U5, U8–U11 |
| 5 | `refactor-lib-layout` | `84b1687` | S11, A3–A5, A7, A9, A10, T3 |
| 6 | `refactor-model-plugins` | `cf94171` | M1–M5, M9, M10, M12 |
| 7 | `refactor-sheet-element` | `39c41e0` | E3, E4, E7–E15 |
| 8 | `refactor-styles` | `402e8ca` | C1–C5, A8 |
| 9 | `fix-review-leftovers` | `ab32c5c` | S5–S7, S12, the rest of U12 and U13, A11 |

### Paydown after the platform roadmap (2026-11-25)

The four roadmap changes in [platform.md](platform.md) added debt of their
own. One round paid it down before the "Later" work starts:
- **One wording for the desk.** Letter states, broken seals, lint outcomes,
  unreadable files, and stack problems are written once, in
  `components/desk-copy.ts`. The app, the `a4` command, and the mailroom all
  use it, so they say the same thing.
- **A smaller Library panel.** `LibraryPanel.tsx` went from 885 lines to 317.
  The folder section moved to `components/library/FolderSection.tsx`, and
  the helpers it shares with the panel moved to `components/library/shared.ts`.
- **Lint fails on warnings.** The 43 warnings are fixed, and
  `pnpm lint:code` now runs with `--error-on-warnings`.
  - Nested ternaries became lookups or small helpers.
  - Groups of controls are `<fieldset>`s, and the lens legend is a
    `<figure>`.
  - Only test files may use `!`. Biome's fix for `!` swaps it for `?.`, which
    would quietly skip the check.
- **Knip fails on every finding.** The 93 unused exports and 56 unused types
  were made module-private or deleted. The three configuration hints are
  applied, so knip now reads the CSS files.
- **Patch bumps:** Biome 2.6.9 and `cf` 1.0.0-rc.5. `onnxruntime-web` stays
  pinned, because `@huggingface/transformers` pins it.

**What the Later work starts from:**
- A server-backed desk can reuse the store contract suites in
  `lib/persist/store/testing/contract.ts` as they are.
- Third-party pens and overlays are feature work, not debt: the plugin
  manifest only lists bundled plugins, by design.

### Paydown after the Later work (2026-11-25)

The three Later changes (signed plugins, share links, and the served
library) were each reviewed for the debt they added. The reviewers found
about 34 items. This round fixed the confirmed bugs and the duplication
with the clearest payoff, and recorded the rest below. Three later changes,
`harden-served-protocol`, `harden-pens-and-plugins`, and
`finish-tech-debt-review`, took up every item left, so none remains.

**Bugs fixed:**
- **A shared view could change the reader's own pages.** With a share link
  open, Page > Clear and Compare's Swap acted on the reader's pages hidden
  underneath. Now `components/workbench/stage.ts` decides what the stage
  shows. While a link is open, `editable` is false, Clear isn't offered, and
  Swap and Duplicate A into B are hidden.
- **A client that disconnected mid-request crashed `a4 serve`.** Every
  request now runs behind one guard. A failure is logged by its error code,
  never its text.
- **A served file that isn't UTF-8 was silently corrupted.** It was read
  with replacement characters, and the next save, rename, or trash wrote
  them back. The store now decodes strictly and refuses such a file as
  unreadable. A listing no longer reads every page's text, and a file
  deleted mid-listing no longer fails the listing.
- **A broken `#serve=` escape threw inside an effect** and took the app down
  on load. It's now an invalid link, with a warning.
- **Installed pens:**
  - a rejected key is now forgotten, as Fit to page's is;
  - an empty key no longer shows as set;
  - a job reads the pen's current card, so an updated pen doesn't run as its
    old version;
  - a removed pen's job is cancelled;
  - every pen's progress chip shows in the top bar, not only Fit to page's.
- **A remote lens after a preset change** offered no "Score again", though
  its planes were hidden.
- **`a4 open` could half-write a pair** when a name was too long for the file
  system. Names now follow the page-name rules (at most 80 characters).
- **`a4 share`** now reads a seal with the desk's path and size limits.
- **A failed Remove** now shows a notice instead of rejecting silently.
- **The bundle check's plugin rules matched nothing,** because their paths
  predate `lib/models/plugins/`. Each source rule now names a file that must
  exist. Fixing the check found a leak: the model host and the
  installed-plugin client and checks were in the first load, through one
  re-exported message. The first load went from 15 chunks and 834 KiB to
  13 and 817 KiB.

**Duplication removed:**
- **Byte helpers.** Capped reads, raw DEFLATE, base64, base64url, hex, and
  byte equality had copies in the archive, share, models, desk, and
  platform layers. They now live once, in `lib/platform/bytes.ts`.
- **Pens.** Fit to page's job and key and the installed pens' jobs and
  credentials are built by one hook, `components/workbench/usePens.ts`.
- **A letter and its postmark** are read by one desk function,
  `readSealedLetter`, for the app's share link and `a4 share`.
- **The connect link.** Its format, the app's origin, and the default port
  are defined once (`lib/persist/store/served.ts`, `lib/platform/origin.ts`).
  The two fragment hooks share `clearFragment`.
- **The served library's helpers.**
  - Its target helpers moved to `lib/workspace/library-target.ts`, and a
    switch now reaches the server once rather than twice.
  - The Node adapters share hidden temporary files and error codes.
  - The test fake's locks build on the in-process ones.
- **`a4`'s command list** comes from its options table, not three copies.

**Types and docs:**
- An install inspection is a union (install, or update from a version).
- `LibrarySource` names the browser-or-served choice.
- The README and the installed-plugins spec now say what the code does: a
  plugin's signature is checked when a tab loads it, and the plugin runs
  only from the copy checked.
- The README says to keep `.a4-serve-token` out of git.

**Taken up by `harden-served-protocol`:**
- **The store protocol was mirrored by hand.** Now:
  - `lib/persist/store/wire.ts` derives the methods from the generated
    service;
  - the server's handler table must cover every method to compile;
  - each conversion sits beside its inverse;
  - failures carry a typed detail.
- **A served library had no identity.** Now:
  - each library folder keeps an id in `.a4-library`, which the app learns
    from `GetLibrary` with the protocol version;
  - drafts, tab messages, and open pages are kept by that id;
  - a server of another version is refused, saying what to do.

**Taken up by `harden-pens-and-plugins`:**
- **The pen UI was written three times.** Now:
  - `components/PenPanel.tsx` renders every pen, Fit to page included, with
    its words from `penPanel(card)`;
  - one consent dialog, mounted once, confirms every remote call in
    `consentDialog()`'s words, and names the plugin;
  - `usePens` builds every pen the same way and returns them as a list.
- **`PluginId` stopped at the registry.** Now the registry, `useModels`, the
  Models panel, and the Workbench take `PluginId`, and a damaged plugin is
  removed by `removeDamaged`. A compile-time test refuses a plain string.
- **The Models panel's copy was inline.** It's in `modelsPanel`.
- **The plugin lifecycle.** Now:
  - an install, update, or removal posts an `a4.v1.PluginEvent` on
    `a4-plugins`, and other tabs reconcile that one plugin;
  - Remove closes an installed plugin's client for good, so a sandbox still
    starting closes as soon as it opens;
  - a model file is hashed when it's downloaded and when its plugin starts,
    and status only looks up a file this tab already checked.

**Taken up by `finish-tech-debt-review`:**
- **Smaller copies.** Each is written once now:
  - `lib/platform/idb.ts` opens a database, runs a request, and lists a
    store, for the plugin and folder-handle stores;
  - `lib/models/signing-key-node.ts` makes, reads, and signs with Ed25519
    keys, for the CLI, the example build, and the test packages;
  - `PollLoop` (`lib/persist/autosave/poll.ts`) runs `LibraryPoller` and
    the folder watcher;
  - the shared view's words are in `share-copy.ts`, and the served
    library's in `served-copy.ts`.
- **The Connect form closed when the server was down.** Now it checks the
  server first. If A4 can't use it, the form stays open and says why, and
  nothing is remembered.
- **A shared page was the empty slot with a label.** Now it's a
  `SharedSlot`, and every slot on the stage has a `kind`.

### Paydown after the hardening changes (2026-11-27)

The three changes that closed the last round (`harden-served-protocol`,
`harden-pens-and-plugins`, and `finish-tech-debt-review`) were each reviewed
for what they added or kept. The reviewers found about 25 items. This round
fixed the bugs and the cheapest duplication, and records the rest below.

**Bugs fixed:**
- **A tab loading its plugins could keep a removed one, or stop working.** A
  change another tab made while this tab read its plugins was applied before
  the load finished. A removed plugin stayed registered, and an update made
  the load fail for good, which stopped every model in the tab. The load now
  runs first in the queue of changes.
- **Any plugin change set every installed plugin back to "checking".** That
  turned an on lens off and interrupted a download. Now only a plugin that's
  new, or a new version, is checked again.
- **A lens's consent dialog outlived its plugin.** After an update in
  another tab, it still named the old host, while Send went to the new one.
  A request whose plugin was removed or updated is now dropped, and Send
  checks again.
- **Remove didn't stop a download in progress.** It now aborts it, and
  nothing is stored.
- **A changed model file stayed "ready".** The start refused it, but the
  card never offered the download again. A score that fails as not ready
  now checks that plugin's status again.
- **A refused connect link left the old served library in place.** While
  another served library was shown, the notice said this browser's library
  was shown, but edits still saved to the old folder. Now this browser's
  library is shown.
- **The Connect form could close without connecting.** The server answered
  its check, then stopped before the switch. Now the form reaches the server
  once, remembers it only once its pages are shown, and keeps every failure
  inline.
- **An answer cut off mid-body read as an empty listing.** That could create
  an Untitled page in the served folder. It's now the server stopping.
- **`--new-token` replaced the token before the id file was checked.** A
  damaged `.a4-library` then disconnected every browser for nothing.
- **A disk or permission error on the server read as "an answer A4 can't
  read".** It now reaches A4 as a typed failure naming the error's code.
- **The folder watcher missed an outside edit made just before a re-watch.**
  This happened during a swap or a library switch, and predates this round.
  A re-watched file is now read and compared once.
- **A poll pass that threw went unhandled.**
- **An IndexedDB connection that failed or closed was kept.** Every later
  call then failed until a reload. It now reopens.

**Duplication and copy:**
- `remove` and `removeDamaged` share one body, and `PluginFiles` is a `Pick`
  of `PluginStore`.
- The empty slot is defined once (`EMPTY_SLOT`).
- The shared view's label, buttons, and save notice, the served library's
  region and action names, the pen panel's "Instruction" and "Cancel", the
  consent dialog's buttons, and the Models title moved into `*-copy.ts`.
- Tests were added for each bug above, `pack`'s key refusals, a damaged
  record heard from another tab, and a failing poll pass.

**Left for a later round:**
- **A library's id is learned once per connection.** Serving a copied
  folder behind the same address and token keeps the original's id, and a
  server upgraded mid-session isn't noticed until the next switch. The
  README now says to delete the copied token too; the poller could ask for
  the library again when the server comes back.
- **A refused origin looks like a stopped server.** A page served from an
  origin `a4 serve` doesn't allow (a dev server without `--origin`) is told
  `a4 serve` isn't running.
- **The served library's refusal sentences are written twice.** Once in
  `lib/` as the error's message, once in `served-copy.ts`.
- **`LibraryId` is a plain string.** Branding it, like `PageName`, would
  stop an address being passed where an id is meant.
- **Smaller copies:** the two store contracts' `check` and `runInBrowser`
  loops; `PluginInstallDialog` reusing the pen panel's key classes; the page
  commands' action names written inline in `useWorkspace.ts`.
- **In development only, Vite's client runs inside the Semantic repetition
  worker.** Vite rewrites the ONNX runtime's variable `import()` calls with
  a helper it imports from `/@vite/client` in a module worker. On every CSS
  hot update, that client looks for `document` and logs an error. Builds
  aren't affected.

The rest of this document is the review as written on 2026-11-23, with a
status line added to each area.

## Summary

- **The base is sound.**
  - No import cycles.
  - `lib/` never imports from `components/`.
  - No `any`.
  - Strict TypeScript with zero errors.
  - 262 tests, and property tests where the guarantees matter (the tensor
    codec, faithful saves).
- **Debt is concentrated in a few places.**
  - Two god modules: `components/useLibrary.ts` (977 lines, 31 `useCallback`,
    12 `useRef`) and `components/Workbench.tsx` (967 lines, 24 `useState`,
    5 lint suppressions).
  - Contracts typed as strings: element events and attributes, lens classes,
    error codes, plugin ids, finding prose.
  - A catch-all `lib/` root.
  - A 2,000-line global stylesheet.
  - No linter, no boundary rules, and no UI tests.
- **The review found real bugs.** Some are user-visible today (B1, B2), and
  some can lose or orphan edits in rare races (B3–B6). Fix these first,
  separately from the refactor.

| Metric (non-test TS, 81 files) | Count | Where |
| --- | ---: | --- |
| `as unknown as` | 15 | session.ts 3, a4-sheet.ts 2, fit/adapter.ts 2, semantic/worker.ts 2 |
| other `as T` casts | 79 | useLibrary.ts 12, session.ts 7, Workbench.tsx 6, opfs.ts 5 |
| non-null `!` | 12 | useLibrary.ts 7 |
| lint suppressions | 5 | all in Workbench.tsx; one hides a bug (B13) |
| `any` | 0 | |
| import cycles | 0 | |

## Bugs found

Fix these first, in one small change.

**Status:** all 21 are fixed in `fix-review-bugs` (`e6e755e`), each with a
regression test. The Status column keeps how each bug was verified.

| ID | Severity | Status | What happens | Where | Fix |
| --- | --- | --- | --- | --- | --- |
| B1 | high | Fixed | A folder file opened with `visibility: hidden`, so the page was blank on screen and in print. | Workbench.tsx:837, 854 used the library-only `name`. | Hide on `!state.ref`; label from `state.label`. |
| B2 | high | Reproduced | A library page whose text starts with U+FEFF, or contains a lone surrogate, conflicts on every save. `Blob.text()` drops the BOM, and `write(string)` replaces surrogates, so the revision returned by `create` never matches the stored text. | opfs.ts:145, 164 | Decode with `ignoreBOM: true`; refuse non-well-formed text and names at the boundary; add contract cases. |
| B3 | high | Reproduced | When a file session moves its text to a library copy, keys typed during the copy are journaled under the old id, then cleared. The session ends dirty and stopped, with no draft. Only the UI's re-apply saves them, so a crash in that window loses them. | session.ts:220-230 | After `create`, keep the draft if the text moved on, and carry the pending text in the event. |
| B4 | high | Confirmed | Each Open folder… mints a new random folder id. Picking the same folder in two tabs splits the locks (no cross-tab serialization) and the draft namespaces; old drafts and IndexedDB entries are orphaned. | connection.ts:114-118 | Reuse the stored id when `isSameEntry` matches. |
| B5 | high | Plausible | Closing a session right after a failed save stops retries. The draft stays in this tab's journal, which recovery skips (its own tab). Reopening the page overwrites it. | session.ts:298-303, bootstrap.ts:52 | On construction, merge or surface an existing draft for this tab; or keep orphaned saves retrying. |
| B6 | high | Plausible | `openInSlot` isn't serialized per slot. The Compare effect's `ensureSlotB` races `createPage(…, "b")` from Fit to page and samples, so a session can be overwritten without `dispose()`, and Single→Compare→Single can leave B open. | useLibrary.ts:370-458; Workbench.tsx:193-199 | Per-slot command queue or generation token; make entering Compare an explicit command. |
| B7 | high | Plausible | Reloading in Compare loses a remembered folder file in B: `ensureSlotB` runs before the folder reconnects and overwrites `a4:open:b`. | useLibrary.ts:532-533, 765-788 | Give B the same pending-fallback handling as A, or open B after the folder restore settles. |
| B8 | high | Confirmed | A worker that crashes or fails to load leaves every pending model call waiting forever: the transport listens only for `message`. The host caches the dead client for the whole tab. | worker-transport.ts:98-106; host.ts:113-123 | Wire `error` and `messageerror` to fail pending calls; evict closed clients; add per-call deadlines. |
| B9 | high | Confirmed | After a GPU device loss, the 3D sheet freezes. It never falls back to flat and never reports it. | gpu.ts:21-23; a4-sheet.ts:504 | `onLost` → `lost` state → retry once → flat, then report. |
| B10 | high | Confirmed | `isPresetId("toString")` is true (`in` checks the prototype chain). A stale `a4:preset` or `<a4-sheet preset="constructor">` yields a function as the page spec. | page-spec.ts:83-85 | `Object.hasOwn`, or derive from `PRESET_IDS as const`. |
| B11 | medium | Reviewer-reproduced | `sanitizePageName(". .x")` returns `".x"` without validating. Zip import then aborts partway, and legacy migration fails on every boot. | names.ts:46-48 | End with `parsePageName`; never use `as PageName` outside the parser. |
| B12 | medium | Plausible | "Save to folder…" saves whatever is in the slot when the form is submitted, not the page it names. | Workbench.tsx:133, 642; useLibrary.ts:933 | Carry a `LibraryRef` in the request. |
| B13 | medium | Plausible | Turning on the Semantic lens scores twice: once immediately, and again 1.5 s later from an effect with a stale `scored` (its deps are suppressed). | Workbench.tsx:296-320 | `useSemanticLens` with per-slot request ids. |
| B14 | medium | Plausible | A Fit to page request outlives its component (collapse Models, hide the inspector, or press F), with no Cancel button, then jumps to Compare. | FitToPage.tsx:39-42, 72-105 | A `FitJob` controller above the inspector; at minimum, abort on unmount. |
| B15 | medium | Plausible | Ctrl+S shows "Saved" even when the flush ended in an error. Open, duplicate, restore, and purge failures become unhandled rejections with no toast. | Workbench.tsx:206, 474, 765-775 | One result/error convention, plus one toast adapter. |
| B16 | medium | Confirmed | Model cards are shared mutable objects. The consent gate reads `card.sendsTextOffDevice` from the same object `list()` returns, so any app code could turn consent off. There are no third-party scripts, so this is defense in depth. | host.ts:93-96, 207; cards.ts:11 | Freeze and clone the cards at registration; derive a private egress policy. |
| B17 | medium | Confirmed | Finding spans from plugins aren't validated before `setSelectionRange`. Planes with depth > 1 would paint garbage. Planes are keyed by plugin id, so a second plane replaces the first. | host.ts:173-196; Workbench.tsx:326 | Validate spans and depth in the host; key planes by plugin and plane name. |
| B18 | medium | Plausible | A disconnect while a 3D renderer is being created, then a quick reconnect, leaks the first renderer's GPU buffers. | a4-sheet.ts:313, 495-512 | One renderer state union with a creation token. |
| B19 | low | Reviewer-reproduced | The analysis is inconsistent: a 3-line `key: value` page shows the Narrative bar as "warn" with no finding, a null narrative renders as 0, and "Reads clean" appears beside a syntax note. The thresholds are written three times. | analyze.ts:302-417; MetricsPanel.tsx:49-53, 246 | Compute one `Signals` record; the verdict, the findings, and the bars all read it. |
| B20 | low | Confirmed (live site) | A folder file's path in the top bar is invisible in dark mode: it uses the paper's ink color. | globals.css `.file-path` | `var(--text)`. |
| B21 | medium | Reproduced (found during the fix) | A create, rename, trash, or restore whose write fails leaves an empty page in the library, or an empty file in the folder: the file is created before it's written. | opfs.ts, folder.ts | Remove the new file when its first write fails. |

## Debt by area

### Storage, autosave, and folders (`lib/store`, `lib/autosave`, `lib/folder`)

**Status:** all done. S1–S4 in `refactor-typed-contracts`, S8–S10 in
`refactor-workspace-controller`, S11 in `refactor-lib-layout`, and S5–S7 and
S12 in `fix-review-leftovers`.

- **S1 Session kind by cast:** whether a session may follow a copy in its
  own store is guessed from `copies`, then forced with
  `as unknown as PageStore`. A `PageSession<FilePath>` without `copies`
  compiles, and loops forever on a conflict. Fix: a discriminated
  `RelocationPolicy<Id>` (`same-store` or `copy-out`), and `rename` only on a
  `LibrarySession`.
- **S2 Forgeable brands:** brands are cast from raw storage strings
  (key-value.ts:120, 201; opfs.ts:124, 136, 212; journal.ts:91, 107). A stale
  journal key aborts recovery. Fix: give `Journal` an `IdCodec<Id>`, and have
  backends parse or skip each listed entry.
- **S3 Unreadable sentinel:** `"" as Revision` marks "unreadable", while
  `expected` is checked by truthiness, so passing `error.actual` back would
  turn a conditional write into an overwrite. Fix: `Revision | null` and
  `expected != null`.
- **S4 Errors by string code:** `isStoreError("conflict")` doesn't narrow to
  `PageConflictError`. Fix: a code-to-class map and a protected base
  constructor.
- **S5 Unwritten contract rules:** case rules, `list` order, the source of
  `modifiedAt`, `size` under `sheetFiles`, partial lists, and rename
  atomicity. The contract tests also assume `revision === revisionOf(text)`,
  so `sheetFiles`, which sessions actually use, is never run through them.
  *Done* in `fix-review-leftovers`:
  - The core suite treats revisions as opaque, and runs on `sheetFiles` with
    sheet text.
  - `types.ts` states the rules: an unordered list, stored size, last-write
    time, the folder list's scan limit, and what an interrupted rename
    leaves.
- **S6 Cross-tab races:** `rename` and `restore` lock only one name and pick
  their target outside the lock. A case-only rename can delete the page on
  case-insensitive storage. `KeyValuePageStore` has no lock at all.
  *Done* in `fix-review-leftovers`:
  - `rename` holds both names' locks, in sorted order.
  - `restore` claims its name under the lock.
  - A case-only rename goes through a temporary page.
  - `KeyValuePageStore` takes the same locks.
- **S7 Name races:** `availableName` followed by `create` appears in 6
  places, and another tab can take the name in between. Fix:
  `createUnique(desired, text)` under the store's lock.
  *Done* in `fix-review-leftovers`: `PageStore.createUnique` claims the
  name under its lock. Eight callers use it: these six, zip import, and the
  move from the localStorage fallback. `availableName` is gone.
- **S8 `FolderConnection` does too much:** IndexedDB, permissions, the
  journal prefix, and recovery, and its `forget()` re-implements recovery
  with different rules. Fix: split it into a registry and an access state
  machine; `forget` reuses `recoverDrafts`.
- **S9 Folder internals leak:** `root` and `handle()` are public, the watcher
  stats through them, the UI scans the raw handle, and DOMException names are
  matched in 4 files. Fix: a `FolderFs` port (`entries`, `stat`, `readBytes`,
  `writeAtomic`) with browser and Node adapters.
- **S10 Globals and duplicates:**
  - `Date.now()`, `crypto`, `indexedDB`, and `navigator.locks` are read
    directly.
  - Four copies of the DOM-error helpers, two of `writeFile`, two of the lock
    wrapper, and two of the localStorage probe.
  - `LockLike` lives in opfs.ts.

  Fix: platform ports (`Clock`, `Locks`, `KeyValue`, `RandomId`,
  `HandleStore`) in one place.
- **S11 Barrel exports internals:** `lib/store/index.ts` exports skip lists,
  OPFS directory names, and path constants that nothing outside uses.
- **S12 Fakes drift from browsers:** they are case-sensitive, list in
  insertion order, and never fail a stale snapshot. Fix: options to model
  each.
  *Done* in `fix-review-leftovers`: `FakeVolume` options model names that
  ignore case, other listing orders, and stale snapshots. The contract
  suites also run with them on.

### UI (`components/`, `app/`)

**Status:** all done. U1–U5 and U8–U11 in `refactor-workspace-controller`,
U6 and U7 in `refactor-typed-contracts`, and the rest of U12 and U13 in
`fix-review-leftovers`.

- **U1 `useLibrary` is a god hook.**
  - It owns startup, two sessions, the channel, the folder connection,
    scanning, watching, a pending-file state machine in refs, and English
    messages.
  - It returns 22 actions in an unmemoized, untyped object.
  - None of it runs under `node --test`.

  Fix: a plain TS `Workspace` with `subscribe`, `getSnapshot`, and `dispose`,
  plus a `useWorkspace` hook built on `useSyncExternalStore`.
- **U2 `Workbench` is a god component.** It holds settings, zoom math,
  shortcuts, the GPU fallback, scoring, Fit orchestration, file I/O, toasts,
  and all the markup. Every `a4-viewchange` and pose frame re-renders the
  library and the inspector. Fix: `useLayout`, `useShortcuts`, `SheetStage`
  (owning view and pose state), `Topbar`/`PageMenu`/`ViewMenu`,
  `useAnalysis`, `useSemanticLens`, and `FitJob`.
- **U3 Slot text lives in four places:** React slot state, the `latestText`
  ref, the session, and the element. Fix: a `SlotController` that is the only
  owner of a slot's ref, text, status, and session.
- **U4 `OpenPage` pairs a ref with `AnySession` loosely.** This forces 5
  casts and 7 `!` assertions. Fix: a discriminated union by ref kind, and a
  generic `FileWatcher<K>`.
- **U5 APIs take `PageRef | PageName`:** `sourceName as PageName` can be a
  file path, `targetSlot.name!` can be null, and FitToPage's `ref?` is
  optional but always passed. Fix: `PageRef` only; FitToPage takes
  `{ref, label, text}`.
- **U6 Settings by string key:** `readKey(key: string)`, "1"/"0" parsed
  inline, the legacy migration in the component, and ad hoc `inspector:<id>`
  keys. Fix: a typed `Setting<T>` registry with codecs and a `useSetting`
  hook.
- **U7 The cross-tab message is a bare string** (`""` means "lists
  changed"). Fix: an `a4.v1.LibraryEvent` proto, accepting the old string for
  one release.
- **U8 Lifecycle:**
  - `bootPromise` caches a failed startup forever.
  - Unmounting the Workbench neither flushes nor disposes its sessions.
  - `connection.subscribe` is never unsubscribed.
  - Toast timers are never cleared.
- **U9 Three error conventions:** returned strings, thrown errors, and
  toasts.
- **U10 Prop drilling:** `LibraryPanel` takes 25 props, with parallel
  page/file props (`open`/`openFiles`, `onOpen`/`onOpenFile`). Fix:
  ref-based `onOpen(ref, slot)` and grouped action interfaces.
- **U11 Two Escape handlers:** Menu and Workbench both handle Escape, so one
  press closes the menu and the pose panel. Fix: one Escape priority stack.
- **U12 Copies that drift:**
  - The 1100 px breakpoint appears 4 times in JS, against `1099px` in CSS.
  - "1 MiB", "20,000 entries", and "100 MB" are repeated as literals.
  - 210/297 is hard-coded in the zoom math.
  - "Nothing leaves this browser" is false once Fit to page is used.

  *Done:*
  - The breakpoint is defined once (`components/breakpoints.ts`).
  - The zoom math uses the page geometry.
  - Each model card says where page text goes.
  - In `fix-review-leftovers`, the copy reads the 1 MiB, 20,000-entry, and
    100 MiB limits from their constants.
- **U13 Leftovers:**
  - The `sidebar` class, which the print CSS depends on.
  - The `KEYS.library` name.
  - `closeFolder` is an alias, and its button forgets the folder.
  - `rescanFolder` is unused.
  - The Welcome text still says "sidebar" and "Use New".

  *Done:*
  - The `sidebar` class, `KEYS.library`, the alias, and `rescanFolder` are
    gone.
  - `closeFolder` saves, closes, and forgets the folder.
  - In `fix-review-leftovers`, the Welcome text names the inspector and
    Page → New.

### The `<a4-sheet>` element and 3D (`lib/element`, `lib/paper`)

**Status:** all done. E1, E2, E5, and E6 in `refactor-typed-contracts`; E3,
E4, and E7–E15 in `refactor-sheet-element`.

- **E1 Untyped events and tag:** event names are repeated as literals in 3
  files, every event detail is cast, and there is no `A4SheetEventMap` or
  `HTMLElementTagNameMap` entry. Fix: a `lib/element/contract.ts` with
  `A4_EVENTS`, the event map, and typed `addEventListener` overloads.
- **E2 No attribute schema:** names, ranges, and defaults are copied across
  the element, the wrapper, the docs page, and SheetControls (tilt 0–65
  appears 3 times; light accepts −360..720 but the slider is 0..360). Fix:
  one `ATTRIBUTES` table that drives `observedAttributes`, a pure state
  reducer, the wrapper, and the docs.
- **E3 Full repaint every frame:** orbit and fold repaint and re-upload the
  whole texture, one `fillText` per glyph, and orbiting one sheet in Compare
  repaints both. Fix: track what changed, and repaint only for content.
- **E4 The element runs the full `analyze()` just to paint**, duplicating the
  Workbench's call. Fix: give the painter a narrow `PageModel`.
- **E5 Lens styles are free strings** mapped through
  `Record<string, CellStyle>`; a renamed class paints Ink silently. Fix: a
  `SegmentStyle` union (shared with A5).
- **E6 `lens` carries two things:** a built-in id, or `model:<plane>` behind
  a prefix that the wrapper redeclares. Fix: export `parseLensAttr`, or add a
  separate `plane` attribute.
- **E7 The React handle exposes the raw element:** the Workbench calls
  `setSelectionRange` on it, and `fold()` throws before upgrade. Fix: a
  `{focus, select, fold}` handle that waits on `whenDefined`.
- **E8 Orbit and fold don't reflect into attributes**, so setting the same
  prop again can't reset them.
- **E9 Paper geometry is recomputed in more than a dozen places,** with three
  separate fit calculations. Fix: one `lib/sheet/geometry.ts`.
- **E10 The deformation is written twice** (WGSL and TS) with "keep in step"
  comments and no parity test. Fix: deform on the CPU and upload vertices;
  the shader only transforms.
- **E11 GPU code isn't testable:**
  - The device is a module singleton.
  - The uniform block is a bare `Float32Array(32)` with magic offsets.
  - `WebGpuUnavailableError` is dead code, and errors are swallowed.

  Fix: an injected `GpuProvider` and a tested `packUniforms()`.
- **E12 Untested painting:** `paintPage` is 190 untested lines, and the paper
  colors are duplicated between the shadow CSS and the canvas (the selection
  alpha already differs: 0.25 against 0.28). Fix: `PAINT_THEME` tokens and
  per-layer painters over a `Paint2D` interface.
- **E13 Plane validity depends on the element's current preset** when the
  plane is set, so the wrapper's effect order matters. Fix: each plane
  carries `cols`; pure `validatePlane`.
- **E14 Normalization wipes native undo:** dropped text containing a tab or
  CR is fixed by assigning `.value`, which clears undo and moves the caret.
  Fix: `setRangeText`, skipped while `isComposing`.
- **E15 The docs show a standalone import that no build produces,** and
  `defineA4Sheet("x")` throws after the default definition.

### Models and the tensor (`lib/models`, `lib/tensor`, `proto/`)

**Status:** all done. M6, M7, and M11 in `refactor-typed-contracts`; M8 in
`add-code-guardrails`; the rest in `refactor-model-plugins`.

- **M1 Adding a plugin touches four places:** two lists ("keep in step"), a
  download map, and `card.id === X` branches in two UI files. Fix: one
  `manifest.ts` with `definePlugin({card, connect, isDownloaded})`, lazy only.
- **M2 The UI imports plugin internals:** thresholds, `cellValue`,
  `FIT_HOST`, `FIT_MODEL`, a hard-coded "0.60 → 1.00" legend, and literal
  score names. Fix: a light `descriptor.ts` per plugin, and display metadata
  in the card.
- **M3 Consent is structural only through the host:**
  - `grantConsent` is a free export.
  - A raw plugin client can be obtained without the host.
  - Encode and Generate have no host path.

  Fix: a host-owned `ConsentBroker`, and one egress guard for every
  operation.
- **M4 The API key is a module `let`:** `currentApiKey` is exported to
  everyone. Fix: a host-level in-memory `CredentialStore`, injected into the
  plugin.
- **M5 Cards have no per-operation capabilities** (planes, scores, finding
  kinds, instructions, credentials), so the UI can't render plugins
  generically. `presets` is never enforced.
- **M6 Error codes:**
  - A TypeScript union duplicated in a `Set`, sent as a `string` on the
    wire.
  - The code "cancelled" uses British spelling.
  - Registration problems reuse result codes.

  Fix: an `ErrorCode` enum in the proto.
- **M7 `RpcFrame` mixes call, cancel, end, and error** through flags and a
  magic `$cancel`, and undecodable frames are dropped silently. Fix: a
  `oneof`, and an error reply whenever a frame has an id.
- **M8 `buf breaking` isn't run** even though it's configured.
- **M9 The semantic worker keeps state in module `let`s** and serves on
  import; its glue is untested. Fix: a factory with closure state, tested
  over a `MessageChannel`.
- **M10 Download need is decided by the privacy flag**, not by
  `downloadBytes`, and a missing cache check defaults to "downloaded".
- **M11 Casts and ids:**
  - The `as unknown as` casts trace back to the missing `webworker` lib.
  - Plugin ids are plain strings. Fix: a branded `PluginId`.
- **M12 Contract and dead code:**
  - Host sheets break the proto's own rule that the grid must decode to the
    text.
  - `cellIndex` and `CellRect` are unused, and `View.PIXELS` and Encode and
    Generate are unused.
  - A test title is wrong ("about 5 KB" while asserting 9–11 KB).
  - Consent is matched by a non-cryptographic hash instead of the exact
    text.

### Page model and analysis (`lib/` root)

**Status:** A1, A2, and A6 done in `refactor-typed-contracts`; A3–A5, A7,
A9, and A10 in `refactor-lib-layout`; A8 in `refactor-styles`; A11 in
`fix-review-leftovers`.

- **A1 Findings are English prose** (`{id: string, title, detail}`), so a CLI
  gets copy, not data, and the tests check prose with regexes. Fix:
  `Finding` as a discriminated union of data; `describeFinding()` in the UI.
- **A2 Verdicts are display labels used as ids** and as CSS selectors
  (`[data-v="Balanced"]`). Fix: `VerdictId` plus a label map.
- **A3 `THRESHOLDS` mixes four kinds of value,** and claims "the specs pin
  these" for three that aren't in a spec. Fix: a typed `AnalysisConfig`
  passed to `analyze()`.
- **A4 Unnamed heuristics:** heading ≤ 80 characters (the Terminal width,
  wrong on Dense), ≤ 10 words, and the structure openers.
- **A5 `Analysis` is a 33-field bag:** spec copies, layout, a `Map` that
  doesn't serialize, verdict, and copy. Fix: `Layout`, `Metrics`, and
  `Assessment`, and an `analysis.proto` report for a CLI.
- **A6 Lens and preset ids aren't checked against their tables:** "ink" is
  handled by `default`, and the tables are mutable. Fix:
  `as const satisfies`, ids derived from the table, and `assertNever`.
- **A7 `page-spec.ts` mixes geometry with fonts, DPI, and UI copy;** the blurb
  hard-codes "80 × 60" and "≈10.5 pt".
- **A8 The paper and lens palette has three sources:** CSS tokens, `rgba` in
  the painter, and hex in the shadow DOM. Fix: one `palette.ts` that feeds
  all three.
- **A9 Character counting:**
  - It is per UTF-16 unit (an emoji counts as 2 syntax characters), and
    this isn't documented.
  - `countInk` exists twice.
  - `TERM` is exported with the `/g` flag.
- **A10 Formatting duplicates:** two `pct` functions, three number
  formatters, and the metric direction declared twice.
- **A11 Spec drift:** the spec scenario has 14 occurrences of "status", but
  the test asserts 28.
  *Done* in `fix-review-leftovers`: the scenario now describes the test's
  page, 14 rows with 28 occurrences.

### CSS (`app/globals.css`, 2,017 lines)

**Status:** all done in `refactor-styles`.

- **C1 Dead rules:** `.lens-dim`, `.lens-syn`, `.lens-kind-*` (the canvas
  paints these), `.brand-tag`, `.tool-label`, `--ruler`, overridden sizing,
  and a duplicate `.verdict`.
- **C2 Fragile order:**
  - The `.library` base rule sits after its drawer override.
  - `.menu-list` and `.menu-item` are each defined twice.
  - The print rules sit before their bases and need 12 `!important`s.
- **C3 Selectors reach into other components:** `.topbar .btn-label`,
  `.pose-panel .sheet-controls`, and `.lib-head .lib-folder-name` (added in
  the last change to beat `.lib-head h2`).
- **C4 Values that should be tokens:**
  - 12 font sizes and 10 radii.
  - The uppercase label recipe written 10 times.
  - z-index values 5 to 50.
  - The hover `color-mix` repeated at 7%, 6%, and 4%.
  - The model violet has no dark-mode value.
- **C5 Breakpoints are duplicated** in JS and CSS.

  Fix: `@layer tokens, base, components, layout, print`; co-located CSS per
  component; print hides chrome by `[data-print="hide"]` in the last layer.
  Tailwind v4 already emits layers and unlayered rules beat them, so move
  everything into layers in one step, keeping preflight.

### Tooling and types

**Status:** all done. T1, T2, T4, and T5 in `add-code-guardrails`; T3 in
`refactor-lib-layout`.

- **T1 Free strictness flags:** these enable with 0 errors:
  `noImplicitOverride`, `noFallthroughCasesInSwitch`,
  `verbatimModuleSyntax`, and `erasableSyntaxOnly`.
- **T2 Flags with small churn:** `exactOptionalPropertyTypes` (13 errors in
  8 files) and `noImplicitReturns` (1).
- **T3 `noUncheckedIndexedAccess`:** 339 errors, 114 of them in
  `paper/camera.ts`. Enable it per folder through a `tsconfig.core.json` for
  the pure modules (`lib: ["ES2023"]`, `types: []`), so the core can't use
  DOM or Node APIs by accident.
- **T4 No guardrails:** no linter or formatter, no import-boundary rules, no
  dead-export check, no stylelint, and no UI tests. Fix: Biome or
  typescript-eslint `strict-type-checked` with exhaustiveness checks;
  dependency-cruiser rules (page depends on nothing, analysis on page, no
  DOM or `@/` in the core); knip; and stylelint.
- **T5 No build check that heavy dependencies stay out of the eager
  chunk:** `@anthropic-ai/sdk`, `@huggingface/transformers`, and
  `onnxruntime-web`.

## Target shape

```
lib/
  platform/     Clock, Locks, KeyValue, RandomId, HandleStore, TabRegistry (browser + node + test adapters)
  page/         spec (geometry, PRESET_IDS), layout (normalize, layoutRows, rowsUsed), chars, geometry (mm↔cell)
  analysis/     config, classify, syntax, terms, tokens, metrics, assess (Signals, VerdictId, Finding union), report
  persist/      store/ (core contract, library backends, FolderFs + FolderFiles), autosave/, folder/ (registry, access,
                faithful, scan, watch), settings (typed Setting<T>)
  archive/      zip, unzip, export, import
  workspace/    Workspace, SlotController, LibraryIndex, FolderIndex, slots (Slot, otherSlot), notices
  render/       element/ (contract, state, EditorSurface, FlatView, PaperView), paper/ (renderer, GpuProvider,
                packUniforms), paint/ (PageModel, PAINT_THEME, layer painters), palette
  models/       contract, transport (fromWorker, fromScope), host (policy, egress guard), consent (broker),
                credentials, manifest; plugins/<id>/descriptor.ts (light) + impl (heavy)
  content/      samples, templates, WELCOME
components/     useWorkspace, useNotices, useSetting, useLayout, useShortcuts, SheetStage, Topbar, panels,
                analysis-copy (describeFinding, labels, formatters)
proto/a4/v1/    + library_event.proto, analysis.proto, ErrorCode enum, RpcFrame oneof
```

**Dependency rules:**
- `page` depends on nothing.
- `analysis` depends on `page`.
- `persist` and `models` depend on `page`, the contracts, and `platform`
  ports.
- `workspace` depends on `persist`.
- `components` depend on `workspace`, `analysis`, `render`, and `models`
  only through their public `index.ts`.
- Nothing in `lib/` reads a browser global except `platform` adapters and
  `render`.

## Plan

Each phase is one OpenSpec change in `openspec/changes/`, and can ship on its
own. Pure refactors use `skip_specs`. Bug fixes and changed contracts carry
spec deltas. The change names below are the plan's phases, in order.

**Status:** all eight are done; the Status table at the top gives each
one's commit.

1. **`fix-review-bugs`:** B1–B21, each with a regression test. The UI bugs
   need a small test harness for hooks and controllers, which phase 3
   reuses.
2. **`add-code-guardrails`:**
   - T1 and T2.
   - A linter and formatter, and dependency-cruiser boundaries matching the
     rules above. Introduce them as warnings, then make them errors per
     folder.
   - knip, stylelint, and `buf breaking` in `proto:check` (M8).
   - The eager-chunk check (T5).
3. **`refactor-typed-contracts`:**
   - Parser-only brands and discriminated errors (S2–S4).
   - `RelocationPolicy` and `LibrarySession` (S1).
   - The element contract and attribute schema (E1, E2, E6).
   - `SegmentStyle`, `VerdictId`, and the `Finding` union (E5, A1, A2, A6).
   - Typed settings (U6), and the `LibraryEvent` proto (U7).
   - `ErrorCode` and the `RpcFrame` oneof (M6, M7), and `PluginId` (M11).
4. **`refactor-workspace-controller`:** platform ports (S10), `Workspace`,
   `SlotController`, `LibraryIndex`, and `FolderIndex` (U1, U3, U4, U8, U9,
   S8, S9), and the Workbench split (U2, U10, U11).
5. **`refactor-lib-layout`:**
   - Move to the target folders, with public `index.ts` files (S11).
   - Split the analysis into config, signals, and report (A3–A5, A7, A9,
     A10).
   - `tsconfig.core.json` with `noUncheckedIndexedAccess` (T3).
6. **`refactor-model-plugins`:** manifest, descriptors, capabilities,
   `ConsentBroker`, and `CredentialStore`; the worker factory (M1–M5, M9,
   M10, M12).
7. **`refactor-sheet-element`:** state reducer, geometry, painting, the
   CPU-only deformation, `GpuProvider`, and change tracking (E3, E4,
   E7–E15).
8. **`refactor-styles`:** `@layer`, co-located CSS, tokens, the palette, and
   dead rules (C1–C5, A8).

## Invariants every phase keeps

- **Autosave:**
  - Every edit is journaled synchronously before any async save.
  - The journal is cleared only after the store confirms the same text.
  - Recovery runs once per tab, after taking the tab lock.
  - Conflicts keep both versions, and folder files are never recreated,
    renamed, or deleted.
- **Faithful saves:** `toFile(raw, toSheet(raw)) === raw`; unedited files
  are never rewritten; and `normalizeLine` matches `normalizeText` line by
  line.
- **Stored formats keep loading:**
  - localStorage `a4:*` keys, including `a4:open:*` with the `file:` prefix,
    `inspector:<id>`, legacy slots, and `mode=paper`.
  - OPFS `a4/pages` and `a4/trash`, and IndexedDB `a4/folders`.
  - Lock names `a4:page:`, `a4:file:`, `a4:tab:`, and the `a4-pages`
    channel, since tabs on mixed versions must still cooperate.
- **The element contract:**
  - Attributes, including `fold-bottom` and `zoom="fit"`.
  - The events `input` (composed), `a4-focus`, `a4-render` (settled only),
    `a4-viewchange` (`turn`), and `a4-posechange` (from `fold()` only).
  - The methods `setPlane`/`removePlane` (RangeError leaves the planes
    unchanged), `setSelectionRange`, `fold`, and `focus`.
  - Upgrade of properties set before definition, and native editing, IME,
    undo, and selection direction in 3D.
- **Models:**
  - Consent is required for each call, bound to the exact text.
  - The API key is never persisted or posted to a worker.
  - The codec is lossless.
  - ONNX runs only in the worker.
  - Heavy dependencies stay out of the eager bundle.
- **Numbers:**
  - Terminal is 80 × 60 = 4,800 cells, with token ceilings of 1,200 and 899.
  - The verdict order is Empty → Overflowing → Noisy → Light → Busy →
    Balanced.
  - The samples keep their verdicts.
- **Print and themes:**
  - Print gives one true-size A4 page of text per sheet.
  - The paper palette stays light in dark mode.
