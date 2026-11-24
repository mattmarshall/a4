# Tasks

## 1. Storage

- [x] 1.1 (B2) Make OPFS reads exact (decode `arrayBuffer()` with `ignoreBOM: true`), and refuse non-well-formed text in every backend with a new `invalid-text` error. Add contract cases for a leading U+FEFF and a lone surrogate. Verify that all backends pass `pageFilesContract`, and that a BOM page saves without conflict
- [x] 1.2 (B11) Make `sanitizePageName` strip leading dots and spaces in a loop and end with `parsePageName`, never splitting a surrogate pair. Parse names read back from storage instead of casting them. Remove `as PageName` from name derivation and store listing (the session's cast goes with `RelocationPolicy` in refactor-typed-contracts). Verify with tests for `" . .x"`, `" . "`, and `"...."`, and an import test where a zip holding `" . .x.md"` imports every page

## 2. Autosave

- [x] 2.1 (B3) On copy-out relocation, keep edits typed during `copies.create` in the library journal and carry them as `pendingText` in the event. The caller's library session saves them. Verify with a test that types during a slow `create`, and asserts the library journal and the copy end with the latest text
- [x] 2.2 (B5) Start a session from this tab's journal draft when it differs from the stored text. Verify with a test: failed save, dispose, reopen in the same tab, then the draft is shown and saved

## 3. Folders and slots

- [x] 3.1 (B4) Reuse a stored folder id when the picked handle `isSameEntry` a stored one (`HandleStore.entries()`). Verify with a connection test where re-picking the same handle keeps the id, the journal prefix, and the lock names
- [x] 3.2 (B6) Add `lib/workspace/slot-requests.ts` (`SlotRequests`, last request wins per slot), and use tickets in `openInSlot`, `ensureSlotB`, and `closeSlotB`. Verify with unit tests for superseded and overlapping requests, and in the browser: Single→Compare→Single fast leaves only A open, and Fit to page during Compare ends with the result in B
- [x] 3.3 (B7) Add `lib/workspace/pending.ts` (`pendingReopen`) and apply the pending-file logic to slot B. Verify with unit tests, and in the browser with a stand-in folder: Compare with a file in B survives a reload
- [x] 3.4 (B12) Make the Save to folder request carry a `LibraryRef`, and `saveToFolder(ref, path)` write that page. Verify in the browser: choose Save to folder for one page, switch the slot, save, and the file holds the first page's text

## 4. Models

- [x] 4.1 (B8) Add a `fromWorker` port that fails pending replies on `error` and `messageerror`, and have the host evict closed clients. Verify with transport tests: a crash mid-stream fails the call within 1 s, and the next call reconnects
- [x] 4.2 (B16) Freeze cloned cards at registration and derive a private egress policy; `list()` returns frozen copies. Verify with a host test that mutating the original card doesn't disable consent
- [x] 4.3 (B17) Validate finding spans, plane depth, and unique plane names in the host, and key planes by plugin and plane name in the Workbench. Verify with host tests for an out-of-range span and a depth-2 plane
- [x] 4.4 (B13) Add `lib/models/semantic/schedule.ts` (`ScoreSchedule`) and use it in place of the suppressed effect. Verify with a fake-clock test (turning the lens on scores once in 3,000 ms), and in the browser (one score in the network or worker log)
- [x] 4.5 (B14) Add `lib/models/fit/job.ts` (`FitJob`) owned by the Workbench, and show a top-bar progress chip with Cancel while it runs. Verify with state-machine tests, and in the browser with a stubbed adapter: collapsing Models mid-run keeps it running and the chip cancels it

## 5. 3D and presets

- [x] 5.1 (B9, B18) Add device-loss handling (`onLost`, one recreation, then flat with `a4-render` "flat") and a creation token in the element. Verify in the browser by destroying the device through a dev-only hook, then confirm flat rendering and the event. Verify B18 with a quick disconnect and reconnect that leaves one renderer
- [x] 5.2 (B10) Make `isPresetId` use `Object.hasOwn`. Verify with tests for `"toString"`, `"constructor"`, and `"__proto__"`, and that `<a4-sheet preset="constructor">` renders Terminal

## 6. UI errors, analysis, and header

- [x] 6.1 (B15) Add `lib/workspace/errors.ts` (`describeError`, `runReported`; in `lib/` so the test runner covers it). Route the fire-and-forget library actions through it, and make Cmd/Ctrl+S report failures. Verify with unit tests for `describeError`, and in the browser with a store that rejects writes (Ctrl+S says saving failed, and a failed restore shows a message)
- [x] 6.2 (B19) Add `signals()` to the analysis, used by `verdictFor`, `findingsFor`, and the MetricsPanel bars, with an `na` state for metrics with no value. Verify with analysis tests (a 3-line key-value page is `na` with no narrative finding; every warn or bad bar has a finding), and that the existing analysis tests still pass
- [x] 6.3 (B1, B20) Add a regression check that an open folder file's sheet is visible, and make the header path use `var(--text)`. Verify in the browser in light and dark themes, with a screenshot of the top bar showing the path

## 7. Integration

- [x] 7.1 Run `pnpm check` and `openspec validate fix-review-bugs --strict`. In the production preview, open a stand-in folder file, edit, reload, and check Compare and the Semantic lens once more

## Workflow follow-up

- Commit and push to deploy, then archive this change.
