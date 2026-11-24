# Design

## Context

- **Storage.** Every page operation goes through `PageStore`
  (`lib/store/types.ts`). It has three backends: OPFS, localStorage, and
  memory. All three pass the shared suite in `lib/store/testing/contract.ts`.
  - A page's identity is its `PageName`. Names are unique ignoring case and
    can't contain `/` or `:` or start with a period.
  - Revisions are `revisionOf(text)`, a content hash.
  - OPFS writes use `createWritable()`, which commits atomically on close.
    The same API writes files in a folder the user picks.
- **Autosave.**
  - `PageSession` (`lib/autosave/session.ts`) journals each edit to
    localStorage, saves with an expected revision, and handles conflicts.
  - On a conflict, it creates a "(conflict …)" copy in the same store and
    follows it.
  - If the page is missing, it recreates the page in the same store.
  - `recoverDrafts` also writes its copies back into the same store.
- **The workbench.**
  - `components/useLibrary.ts` holds one session per slot (A and B), keyed by
    `PageName`.
  - It remembers each slot's page in `a4:open:a` and `a4:open:b`.
  - It refreshes other tabs through a `BroadcastChannel`.
- **The sheet.** The `<a4-sheet>` textarea replaces the whole value with
  `normalizeText` (tabs become two spaces, CRLF and CR become LF) on the first
  input when the value holds a tab or CR. If a repository file reached it
  unchanged, the first keystroke would rewrite every tab and line ending in
  the file.
- See `proposal.md` for motivation and `specs/` for the required behavior.

## Goals / Non-Goals

**Goals:**
- One exact, contract-tested folder backend. All faithful-save logic lives
  in one pure function with property tests.
- Library pages behave exactly as before. Folder support adds code paths and
  doesn't change existing ones.
- A4 never loses text, never overwrites a file it hasn't checked, and never
  writes a file the author didn't edit.

**Non-Goals:**
- Using `FileSystemObserver`. Polling the open files covers the 2-second
  requirement everywhere (see decision 7).
- Watching every file in the folder. Only open files are watched. The list
  refreshes when the tab becomes visible.
- A `.gitignore` parser.

## Decisions

### 1. Pages are referenced, not just named

The workbench addresses a page with a `PageRef`, which is either
`{ kind: "library", name }` or `{ kind: "file", path }`.

- **Paths:** a `FilePath` is a branded, validated relative POSIX path.
  - Segments are non-empty, and none is `.` or `..`.
  - It ends in `.md` or `.mdc`, and is at most 512 characters.
  - It is case-sensitive, matching the folder's own entries.
- **Remembered slots:** `a4:open:a` and `a4:open:b` stay scalar strings.
  - A library page is stored by its bare name, as today, so existing values
    keep working.
  - A file is stored as `file:<path>`. Page names can't contain `:`, so the
    prefix can never collide with a library name.

**Alternative considered:** encoding paths as page names, for example with
`›` for `/`. That's lossy, and makes case and dot-folder rules ambiguous.
**Rejected.**

### 2. The contract splits: core operations and library operations

```
PageFiles<Id>                      list, read, create, write; kind; durable
PageStore extends PageFiles<PageName>   + rename, trash, listTrash, restore, purge
```

- **The suites:** `contract.ts` splits in two.
  - `pageFilesContract(label, make, id)` takes `id(stem)`, which turns a
    test stem into the backend's identifier. The library uses
    `parsePageName(stem)`, and the folder uses `parseFilePath(stem + ".md")`.
  - `pageStoreContract` keeps the library operations.
- **Case:** the "unique ignoring case" test moves to the library suite.
  Folders follow the operating system's file system, which can be
  case-sensitive.
- **Errors:** the error types are unchanged. The folder backend uses
  `invalid-name` for a bad path.

**Alternative considered:** having the folder store implement the full
`PageStore` and throw on rename and trash. That makes the type lie, and
forces the contract suite to skip tests by backend. **Rejected.**

### 3. The folder backend is exact; faithful saves sit on top

There are two layers.

- **`FolderPageFiles`** (`lib/store/folder.ts`) is an exact store over a
  `FileSystemDirectoryHandle`.
  - **Reading:** it decodes UTF-8 with `fatal: true` and `ignoreBOM: true`,
    so a byte-order mark stays in the text as U+FEFF. Invalid UTF-8 throws.
  - **Writing:** it encodes the given text as-is.
  - **Contract:** it passes the core suite unchanged, and its revisions are
    `revisionOf(text)`, the same as the library's.
  - **Locking and atomic writes:** writes take a Web Lock named
    `a4:file:<folderId>:<path>`, check the expected revision, and commit
    through `createWritable()`.
  - **Creating:** it creates missing parent folders.
  - **Refusals:** it refuses any path that isn't `.md` or `.mdc`, which also
    guards against misuse.
- **`sheetFiles(files)`** (`lib/folder/faithful.ts`) is an adapter that
  implements `PageFiles<FilePath>` for the session.
  - **Reading:** `read` returns `toSheet(raw)`, with the raw revision.
  - **Writing:** `write(path, sheetText, expected)` reads the raw text and
    checks `expected` against it. It then writes `toFile(raw, sheetText)`.
    The adapter never tracks a separate base: if the revision matches, the
    current raw text is the base.
- **`toSheet(raw)`:**
  1. Drop a leading U+FEFF.
  2. Drop exactly one final line terminator.
  3. Apply `normalizeText`.

  The sheet then never holds a tab or a CR, so the textarea's
  whole-value normalization can't trigger.
- **`toFile(raw, sheet)`:**
  1. Split `raw` into lines, keeping each line's own terminator.
  2. Normalize each line the way `toSheet` would.
  3. Diff those lines against `sheet.split("\n")` with a Myers line diff.
     - A matched line keeps its original bytes and terminator.
     - Inserted and changed lines use the file's main ending, CRLF or LF,
       by majority, with LF on a tie.
  4. Re-add the byte-order mark and the final newline if `raw` had them.
  5. An empty `raw` gets a final LF.
- **Properties tested** (with a seeded generator over tabs, CR, CRLF, LF, a
  byte-order mark, and a missing final newline):
  - `toFile(raw, toSheet(raw)) === raw` for any `raw`.
  - Replacing one sheet line changes exactly that line in the output.

**Alternative considered:** tracking the base text in the session, and
mapping in `useLibrary`. That spreads fidelity over the UI and the journal.
**Rejected.** The adapter keeps sessions, drafts, and recovery working on
sheet text with no changes.

### 4. Copies are made in the library

`PageSession` and `recoverDrafts` take an optional `copies` store and a
`copyName(id)` function. Both default to the page's own store and its name,
so library behavior is unchanged.

- **For a file session:** `copies` is the library, and `copyName` turns the
  path into a page name.
  - It drops a leading period and replaces each `/` with ` › `.
  - If the name runs over 80 characters, it keeps the trailing segments
    after `… › `.
  - It then applies `sanitizePageName`.
- **When `copies` is a different store** (conflict, or the file is missing),
  the session:
  1. saves the copy,
  2. clears its draft,
  3. stops,
  4. and reports `{ type: "conflict" | "recreated", copy: PageRef }`.

  `useLibrary` then opens the copy in that slot.
- **Other copies:** Fit to page and Duplicate use the same `copyName` with
  " (fit)" or the existing duplicate suffix. They always create the copy in
  the library.

### 5. The folder handle and its drafts

- **Where it's kept:** the handle lives in IndexedDB, in database `a4` and
  object store `folders`, keyed by a random folder id. A
  `FileSystemDirectoryHandle` can only be persisted as a structured clone in
  IndexedDB.
  - There is no record schema. The value is the browser's handle object, and
    the id is the scalar localStorage key `a4:folder`.
  - The project's protobuf default covers serialized records, which this
    isn't.
- **Drafts:** each folder has its own `Journal`, with prefix
  `a4:folder:<id>:`, so draft keys never mix with library drafts.
  - Journal keys parse the tab id up to the first colon, so paths containing
    `:` are fine.
  - Draft recovery for a folder runs when that folder connects.
- **Close and Forget:**
  1. They flush the open file sessions.
  2. They turn any leftover drafts for that folder (from crashed tabs) into
     library copies.
  3. They delete the IndexedDB entry and the key.

### 6. Connecting and reconnecting

The folder states are `none`, `unsupported`, `connecting`, `reconnect`,
`not-found`, and `connected`.

- **On boot:** if the browser lacks `showDirectoryPicker`, the state is
  `unsupported`. Otherwise A4 reads the handle and calls
  `queryPermission({ mode: "readwrite" })`.
  - `granted`: connect.
  - `prompt`: **Reconnect**. Its click calls `requestPermission`, which needs
    a user gesture.
  - A `NotFoundError` while iterating: `not-found`.
- **Chrome 122 and later** can keep the grant across visits. When the user
  allows that, the reload connects silently.
- **Remembered `file:` slots** wait for `connected`. Until then the slot
  shows the default library page (Welcome, or else the most recent page). After the folder connects, A4 reopens
  the remembered file if the user hasn't opened something else in that slot
  meanwhile.

### 7. Changes on disk: polling the open files

- **The polling:** while `document.visibilityState === "visible"`, each open
  file is polled every 1 s with `getFile()`, comparing `lastModified` and
  `size`.
- **When a file has changed:** A4 reads it and compares revisions.
  - No unsaved edits: `adoptRemote`, and say the file was reloaded.
  - Unsaved edits: leave them. The next save gets a revision conflict, and
    decision 4 makes the library copy.
- **The list:** it rescans when the tab becomes visible, and after A4
  creates a file.
- **Other tabs** writing the same file are caught by the same polling.

At most two files at 1 Hz is cheap, works in every Chromium version with the
folder picker, and is easy to test with a fake clock.

**Alternative considered:** `FileSystemObserver`. It shipped only recently,
its specification is still pending, and it isn't needed for 2 s. **Not used
now.**

### 8. Scanning and the list

`scanFolder(handle, { limit: 20000 })` in `lib/folder/scan.ts` walks the
folder breadth-first.

- **Skipping:** it applies the skip rules (`.git`, `node_modules`, and so
  on, plus dot-folders other than `.claude`, `.github`, `.cursor`, and
  `.agents`).
- **Counting:** every directory entry it visits counts toward the limit.
  When it hits the limit, it stops and returns `partial: true`.
- **Classifying:** each `.md` or `.mdc` file is either context or other,
  using the patterns in the spec, matched on the whole path.
- **What each entry holds:** path, size, `lastModified`, and group.
- **Context files:** after the scan, A4 reads each context file of 1 MiB or
  less, a few at a time. It computes rows with `layoutRows` at 80 columns,
  whatever the current preset. A file that isn't UTF-8 gets the not-UTF-8
  reason instead of a row count.
- **Other Markdown** isn't read until it's opened. Opening it is when
  UTF-8 is checked.

### 9. UI

- **Pages panel:**
  - Below the library, a folder section shows its state:
    - the Open folder… button, or the unsupported note;
    - **Reconnect**;
    - **Folder not found**, with Open folder… and Forget;
    - or the file list.
  - **The list:** two groups, Context files (open) and Other Markdown
    (collapsed). Each row shows its path and a rows badge, marked "over"
    when the file runs past 60 rows. Files that can't open show their
    reason.
  - **Search:** the existing search box filters both lists.
  - **The section's header** holds Close folder and New file in folder.
- **Header:** for a file, it shows the folder name and the path as plain
  text, plus the save pill.
- **Page menu:**
  - **Save to folder…** appears when a library page is open and a folder is
    connected.
  - **Rename** and **Move to trash** are hidden for files.
- **Compare:** the caption pickers become a `<select>` with Library and
  `<folder>` groups.

## Risks / Trade-offs

- **[An external write lands between the revision check and the write]** →
  The window is a few milliseconds, and no operating system file lock is
  available. The next poll sees the result, and the journal still holds A4's
  text until a save of that exact text is confirmed. **Accepted.**
- **[Chrome's `.crswap` swap file appears briefly next to the file]** →
  Watchers and `git status` may see it for a moment during a save. It is
  removed on close. Document it in the README.
- **[Write access to a repository raises the stakes of script injection]** →
  A4 loads no third-party scripts, and puts page text only into a textarea
  and canvases. The folder backend refuses paths other than `.md` and
  `.mdc`. A Content-Security-Policy is still the open hardening question
  from `add-sheet-model-plugins`, and this change makes it more valuable.
- **[The desktop app's browser pane may not show the folder picker]** →
  Confirmed during verification: the pane rejects `showDirectoryPicker` at
  once with an `AbortError`. A4 tells the user when the picker is refused
  faster than a person could cancel it. Real-disk checks ran in a separate
  Chrome instead, where the user picked a scratch folder once. The tests use
  the fake folder.
- **[Chrome refuses some folders]** → Chrome blocks sensitive locations, such
  as the home folder itself or system folders. Show the browser's message,
  and suggest picking the repository folder.
- **[A large repository makes the scan slow]** → The skip rules, the
  20,000-entry limit, and reading only context files keep it bounded. Show
  "Scanning…" while it runs.
- **[Edited lines lose their tabs]** → Only the lines the author changed are
  normalized to two spaces. The sheet's grid has no tab cells, which is the
  existing model. **Accepted.**

## Migration Plan

- **Existing values:** `a4:open:a` and `a4:open:b` values without a `file:`
  prefix stay library names, so there is nothing to migrate.
- **Rollback:** reverting the change leaves folder files untouched on disk. A
  stale `file:` slot value matches no library page, so the slot falls back
  to the default page (Welcome, or else the most recent page), as it does
  for any missing page today.
- **Deploy:** through the existing GitHub Actions workflow. No Worker or
  binding changes.

## Open Questions

- Whether to ship a Content-Security-Policy in the same release or as the
  follow-up hardening change named in `add-sheet-model-plugins`. Either way,
  no spec or task here changes.
