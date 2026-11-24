# Tasks

## 1. Contract split and page references

- [x] 1.1 Split `PageStore` into the core `PageFiles<Id>` (list, read, create, write) and the library `PageStore` (adds rename, trash, list trash, restore, and purge). Split `lib/store/testing/contract.ts` into `pageFilesContract(label, make, id)` and `pageStoreContract`, and move the "unique ignoring case" test into the library suite. Verify that the OPFS, localStorage, and memory backends pass both suites, and that `pnpm test` and `pnpm typecheck` pass
- [x] 1.2 Add `FilePath` (`parseFilePath`) and `PageRef`, with scalar encoding: a bare name is a library page, and `file:<path>` is a folder file. Verify with unit tests that `.`, `..`, and empty segments are rejected; that only `.md` and `.mdc` are accepted; that paths are limited to 512 characters; that encoding round-trips; and that existing bare `a4:open:*` values decode as library names

## 2. Folder backend

- [x] 2.1 Extend the test fakes to model a user folder: byte contents, nested folders, `queryPermission` and `requestPermission` states, and a `NotFoundError` once the root is removed. Verify with the fakes' own tests
- [x] 2.2 Implement `FolderPageFiles` in `lib/store/folder.ts`:
  - strict UTF-8 decoding that keeps the byte-order mark;
  - a Web Lock per path;
  - expected-revision checks;
  - `createWritable()` commits;
  - parent folders created on demand;
  - refusal of paths other than `.md` and `.mdc`.

  Verify that it passes `pageFilesContract` unchanged, and test invalid UTF-8, a byte-order mark round trip, and the refusal of `.github/workflows/ci.yml`

## 3. Faithful saves

- [x] 3.1 Implement `toSheet`, `toFile` (a Myers line diff), and the `sheetFiles` adapter in `lib/folder/faithful.ts`. Verify with seeded property tests:
  - `toFile(raw, toSheet(raw)) === raw` across 2,000 generated files mixing tabs, CR, CRLF, LF, a byte-order mark, and a missing final newline;
  - replacing one sheet line changes exactly that line;
  - the spec's 120-line CRLF case;
  - the 140-row file keeps rows 61 through 140;
  - an empty file gains a final LF;
  - the adapter rejects a stale revision with a conflict and leaves the file unchanged

## 4. Scanning

- [x] 4.1 Implement `scanFolder` in `lib/folder/scan.ts` (context patterns, Other Markdown, skipped folders, the 20,000-entry limit, the 1 MiB limit, and row counts for context files at 80 columns). Verify with fake-folder tests for:
  - the 74-row `AGENTS.md` marked 14 rows over;
  - the nested `SKILL.md`;
  - `node_modules` skipped;
  - the 2,000,000-byte file shown as too large;
  - the partial flag at the limit

## 5. Autosave copies and folder drafts

- [x] 5.1 Give `PageSession` and `recoverDrafts` an optional `copies` store and a `copyName`. Implement `copyName` (drop a leading period, show `/` as ` › `, and keep the trailing segments within 80 characters). Verify that the existing autosave tests pass unchanged, and add tests for these folder-file cases:
  - a conflict makes the library copy "AGENTS.md (conflict …)" and leaves the file unchanged;
  - a missing file makes "AGENTS.md (recovered …)" and creates no file;
  - a crashed draft is written to the file when the base matches, and becomes a library copy when it doesn't

## 6. Connecting the folder

- [x] 6.1 Add the folder connection:
  - persisting the handle in IndexedDB behind an injectable handle store, keyed by the `a4:folder` id;
  - the folder states (`none`, `unsupported`, `connecting`, `reconnect`, `not-found`, `connected`);
  - a per-folder journal with the prefix `a4:folder:<id>:`;
  - Close and Forget flushing sessions and turning leftover drafts into library copies.

  Verify with unit tests over fake handles for each state transition, including `unsupported` when the picker is missing
- [x] 6.2 Poll open files every 1 s while the tab is visible. Adopt the disk text when there are no unsaved edits, and leave unsaved edits for the next save's conflict. Rescan when the tab becomes visible. Verify with fake-clock tests that an external change is adopted within 2 s, and that an external change during edits produces a library conflict copy

## 7. Workbench

- [x] 7.1 Move `useLibrary` slots to `PageRef`s:
  - open files through `sheetFiles`;
  - remember `file:` slots and reopen them after the folder connects;
  - name and place the Fit to page and Duplicate copies of files in the library with `copyName`.

  Verify that `pnpm test` and `pnpm typecheck` pass, and check in the browser that library pages still open, rename, trash, and compare as before
- [x] 7.2 Build the UI:
  - **Pages panel:** the folder section (Open folder…, the unsupported note, Reconnect, Folder not found with Forget, the two groups with rows badges and reasons, search by path, Close folder, and New file in folder).
  - **Header:** the folder name and the file's path.
  - **Page menu:** Save to folder…, with Rename and Move to trash hidden for files.
  - **Compare:** pickers with Library and folder groups.

  Verify in the browser on a scratch copy of a repository that the user picks once:
  - opening the folder, listing, and search;
  - opening a file;
  - typing saves, checked with `git diff`;
  - opening without editing leaves the modification time alone;
  - New file in folder, and the existing-path and `../` refusals;
  - a file beside a library page in Compare;
  - Close folder;
  - the network panel shows no request carrying file text or paths
- [x] 7.3 Verify the outside-change and reconnect scenarios in the browser:
  - a shell edit to the open file appears within 2 s;
  - `git checkout` during unsaved edits makes a library conflict copy and leaves the file as checked out;
  - deleting the file during edits makes a library recovered copy and no file;
  - a reload connects silently or shows Reconnect, then reopens the file;
  - a deleted folder shows Folder not found.

  Also verify the unsupported note with a CDP run that removes `showDirectoryPicker` before the app loads
- [x] 7.4 Document folders:
  - **README:** opening a folder, which files are listed, faithful saves, copies going to the library, Reconnect, browser support, and the brief `.crswap` file.
  - **`docs/concept.md`:** move the user-chosen folder out of the next steps.

  Verify that the README's steps match the app

## 8. Integration checks

- [x] 8.1 Run `pnpm check` (tests, typecheck, proto check, and build) and `openspec validate add-folder-pages --strict`. Then open a folder in the production preview (`pnpm start`), and confirm that one edit saves faithfully and that a file changed on disk reloads

## Workflow follow-up

- Commit and push to deploy, then archive this change.
