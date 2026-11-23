# Proposal

## Why

A4 currently holds two pages in `localStorage` slots (A and B). Real use needs
many pages: an agent's context is usually a stack of them (a charter, a
situation brief, a few entity cards). Losing a page to a browser crash,
a closed tab, or a second tab overwriting it would undermine the whole tool. Pages
should also be real files, so they can be handed to an agent or exported as
they are.

## What Changes

- Add a page library: browse, search, create (blank or from a template), open,
  rename, duplicate, move to trash, restore, and permanently delete any
  number of A4 pages.
- Persist each page as a Markdown file in the browser's Origin Private File
  System (OPFS): `a4/pages/<name>.md`, with deleted pages in `a4/trash/`. A
  file's content is exactly the page text.
- Introduce a strongly typed `PageStore` contract (operations, typed errors,
  validated page names, content revisions for optimistic concurrency). Ship
  three backends: OPFS (default), `localStorage` (fallback), and in-memory
  (tests and storage-less browsers). Future backends implement the same
  contract and pass the same contract tests.
- Add autosave that loses no work. Every edit is first written synchronously
  to a local journal. The page is then saved to the store after a short
  pause, when the tab is hidden, or on Ctrl/Cmd+S. Saves that fail are
  retried. A save that would overwrite another tab's newer version is kept as
  a conflict copy. Unsaved journal drafts left by a crashed or closed tab are
  recovered on the next load.
- Request persistent storage so the browser does not evict pages under storage
  pressure, and show the storage backend and save status in the UI.
- **BREAKING (storage):** page text moves from `localStorage` slots into the
  page store. Existing slot text is migrated into the library on first load
  and is never discarded.
- Compare mode compares two library pages. Templates and samples create new
  pages instead of overwriting the open one. Downloads use the page name and a
  `.md` extension.

Out of scope: folders or "reams" inside the library, sync across devices or
browsers, sharing, version history beyond trash and conflict copies, and
importing files from disk.

## Capabilities

### New Capabilities

- `page-library`: The user-facing collection of pages: browse, search, create,
  open, rename, duplicate, trash, restore, delete, first-run content, and
  migration from single-page storage.
- `page-storage`: The typed storage contract for pages, its backends, the OPFS
  layout and file format, backend selection, and cross-tab change
  notification.
- `autosave`: Durability guarantees for edits: the journal, save timing, save
  status, retries, conflict handling, and crash recovery.

### Modified Capabilities

- `sheet-editor`: "Autosave" now covers only preset, lens, and view settings;
  page text persistence moves to the `autosave` capability.
- `page-comparison`: A and B are library pages; the user picks B from the
  library, swap exchanges the pages in the two slots, and "copy A into B"
  becomes "duplicate A into B".
- `narrative-guidance`: Templates and samples create new pages instead of
  overwriting. The welcome page is created in the library on first run, and
  the incident demo creates two pages.
- `page-export`: Downloads are `.md` files named after the page.

## Impact

- New `lib/store/` module (contract, OPFS, key-value, memory backends, name
  validation, revision hashing) and `lib/autosave.ts`, all with Node unit and
  contract tests (OPFS is exercised against an in-memory OPFS fake).
- Workbench UI gains a library panel, a page-name and save-status header, and
  compare-slot pickers.
- Uses OPFS (`navigator.storage.getDirectory`, `createWritable`), Web Locks,
  BroadcastChannel, and `navigator.storage.persist`, with fallbacks where they
  are missing. No server changes; page text still never leaves the browser.
