# Tasks

## 1. One contract for every view of storage (S5)

- [x] 1.1 In `lib/persist/store/testing/contract.ts`, replace each `revision === revisionOf(text)` assertion with the revision rules from design decision 4. Verify the memory, localStorage, OPFS, and folder suites still pass with `pnpm test`
- [x] 1.2 Add the `{ text: "exact" | "sheet" }` option to `pageFilesContract`, and run the folder suite a second time through `sheetFiles` with `"sheet"`. Verify both folder runs pass, and that the sheet run skips only the tab, CR, and byte-order-mark cases
- [x] 1.3 Write the contract's rules on `PageFiles`, `PageSummary`, and `PageStore.rename` in `types.ts` (unordered list, stored size, last-write time, the folder list's scan limit, interrupted renames). Add a `faithful.test.ts` case where a 120-byte CRLF file lists and reads as size 120 through `sheetFiles`, and a folder test where `walkFolder` with a small limit returns a partial list. Verify both pass
- [x] 1.4 Update the README's "Typed store" bullet to say the core suite also runs through `sheetFiles`. Verify the README names both folder runs

## 2. Browser-like fakes (S12)

- [x] 2.1 Add `caseInsensitive`, `listOrder`, and `staleSnapshots` options to the fake volume in `testing/fake-opfs.ts`, with defaults that keep today's behavior. Add `fake-folder.test.ts` cases for each option: a second spelling finds the first entry, `reverse` and `sorted` order the listing, and reading a `File` taken before a write throws `NotReadableError`. Verify they pass
- [x] 2.2 Run the folder contract (raw and `sheetFiles`) with all three options on, and the OPFS library contract with `listOrder` and `staleSnapshots` on. Fix any store bug these runs find, or pause and ask if a fix needs more than a local change. Verify `pnpm test` passes

## 3. Name claims (S6, S7)

- [x] 3.1 Give `KeyValuePageStore` an optional `locks` and wrap each operation in the `a4:page:<lowercased name>` request; `localStorageStore` passes the platform's locks. Verify with a test using shared fake locks that two writes to one page are serialized, and that the library contract still passes
- [x] 3.2 Add `PageStore.createUnique(desired, text)` to OPFS and key-value through one claim helper (pick, lock, re-check, retry, at most 1,000 tries), and route `restore` through the same helper. Add contract cases for two concurrent `createUnique("Untitled")` calls ("Untitled" and "Untitled 2", neither fails) and for a restore racing a create ("Brief" and "Brief 2"). Verify they pass on every library backend
- [x] 3.3 Make `rename` hold both names' locks, in sorted lowercased order (one lock for a case-only rename), with the clash check inside. Add tests for a rename racing a create of its target (one fails with name taken, no text lost) and for two opposite renames at once (both finish, no deadlock). Verify they pass
- [x] 3.4 In the OPFS store, move a case-only rename through `<from> (renaming)` (design decision 3). Turn on `caseInsensitive` for the OPFS contract run from 2.2, and add the "notes" → "Notes" case and an interrupted-rename case (the fake fails the second delete) that leaves the text under a listed name. Verify they pass
- [x] 3.5 Switch the eight callers to `createUnique`: the session's two relocations, both bootstrap creates, `LibraryIndex.create`, the Compare page for B in `Workspace`, `movePages`, and zip import, whose report marks a page renamed when the returned name differs. Make `SameStorePages` require `createUnique`, and remove `availableName`. Verify `pnpm test`, `pnpm typecheck`, and `pnpm lint:unused` pass, and that `grep -rn availableName lib components` finds nothing
- [x] 3.6 Add a README sentence on name claims to the "Typed store" bullet: library backends hand out unique names under a per-name lock, and rename holds both names. Verify the README matches the code

## 4. Limits in copy (U12)

- [x] 4.1 Add `formatByteLimit(bytes)` to `components/analysis-copy.ts`, with tests for 1,048,576 → "1 MiB", 104,857,600 → "100 MiB", and 512 KiB → "512 KB". Verify they pass
- [x] 4.2 Move the import file-size limit to `MAX_IMPORT_FILE_BYTES` in `lib/archive/import.ts`, exported through `lib/archive`. Make the Workbench check and its message use it, and make the library's "too large" note, the folder's partial-list note, and zip import's "too large" skip label read `MAX_FILE_BYTES`, `SCAN_ENTRY_LIMIT`, and `MAX_PAGE_BYTES`. Verify that `grep -rnE '1 MiB|1 MB|20,000|100 MB' components lib --include='*.tsx' --include='*.ts'` finds only tests and doc comments, and that `pnpm test` passes

## 5. Welcome text (U13)

- [x] 5.1 Change the Welcome lines in `lib/content/welcome.ts` to name the inspector and Page → New (design decision 7). Verify `samples.test.ts` passes: Terminal fits, no line wraps, verdict unchanged
- [x] 5.2 Regenerate the four `welcome@<preset>` entries in `components/analysis-copy.snapshot.json`. Verify `git diff` on the snapshot touches only those four keys, and that the analysis-copy test passes

## 6. Spec matches test (A11)

- [x] 6.1 Confirm the repeated-term test in `lib/analysis/analysis.test.ts` builds the page the updated `density-analysis` scenario describes (14 rows, 28 occurrences, repetition at least 40%), and name the scenario in the test's title. Verify the test passes

## 7. Integration

- [x] 7.1 Run `pnpm check` and `openspec validate fix-review-leftovers --strict`, and in the production preview rename a page "notes" to "Notes", create two pages quickly from two tabs, and open a folder with a file over 1 MiB to read the notes. Verify all pass and the copy shows the limits
- [x] 7.2 Mark S5, S6, S7, S12, U12, U13, and A11 done in `docs/tech-debt-review.md` (status lines, the open and partial notes, and the Status summary). Verify the review lists no open findings

## Workflow follow-up

- Commit and push to deploy, then archive this change.
