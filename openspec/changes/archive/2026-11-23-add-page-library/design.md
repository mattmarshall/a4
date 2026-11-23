# Design

## Context

See proposal.md for motivation and specs/ for required behavior. Today the
workbench keeps two strings in `localStorage` (`a4:text:a`, `a4:text:b`). All
analysis is pure and already independent of where text comes from. The app is
client-only; there is no server to sync with.

## Goals / Non-Goals

**Goals:**

- Pages are real `.md` files in OPFS, readable as-is.
- One typed storage contract, so a new backend (a server, the File System
  Access API on a user folder, IndexedDB) can be added without touching UI
  code. Its correctness is checked by the shared contract tests.
- No lost work across crashes, tab closes, multiple tabs, and storage errors.

**Non-Goals:**

- Folders inside the library, sync across devices, history beyond trash and
  conflict copies.

## Decisions

### OPFS layout: `a4/pages/` and `a4/trash/`

```
<OPFS root>/
  a4/                  app namespace; nothing else in the origin collides
    pages/<name>.md    one file per page, content = page text
    trash/<name>.md    deleted pages, restorable
```

The `a4/` namespace leaves room for future siblings, such as `a4/reams/` if
folders arrive, without migrating `pages/`. Names are constants in
`lib/store/opfs.ts`.

Alternatives considered:

- **Files at the OPFS root.** No room for trash or future data.
- **Folders per preset.** A page's preset is a view choice, not identity.
- **Date-bucketed folders.** Browsing is by name and recency, so buckets add
  nothing.

### The file is the page

A file holds exactly the page text, with no front matter. Metadata comes from
the file system: the name is the file stem, and the modified time is the
file's `lastModified`. The revision is a hash of the content. This keeps files
agent-ready and means there is no index that could drift out of sync with the
files.

Alternative: front matter with id, preset, and timestamps. Rejected because it
would put non-page bytes into the file that the page metrics would then
measure.

### Identity is the page name

`PageName` is a branded, validated string, and the file is `<name>.md`.
Human-readable names keep OPFS and downloads legible. A rename is
copy-then-delete under a lock; it is not a `move()`, because browser support
for that varies.

Validation rules:

- Trim the name and collapse internal whitespace.
- Allow 1 to 80 characters.
- Reject `/ \ : * ? " < > |` and control characters.
- Reject a leading period.
- Treat names as unique ignoring case, because some file systems are
  case-insensitive.

Alternative: opaque IDs (ULIDs) plus a name index. Rejected because it needs
an index file and makes the stored files unreadable.

### Revisions are content hashes

A revision is a 53-bit cyrb53 hash of the text, encoded as hex. Two tabs that
save identical text agree on the revision, so they are not in conflict, and
the revision does not depend on clock resolution. Every backend computes
revisions with the same function.

Alternative: `lastModified` plus size. Rejected because it is
millisecond-granular and differs between backends.

### Writes: lock, verify, replace

For `write(name, text, expected)` the OPFS backend:

1. Takes a Web Lock named `a4:page:<lowercased name>`.
2. Reads the current file and compares its hash with `expected`.
3. Writes the new text through `createWritable()`.

`createWritable()` writes to a swap file and commits it on `close()`, so an
interrupted write leaves the old content in place. Browsers without Web Locks
skip the lock; the conflict check still catches most races.

### Backends

- **`OpfsPageStore`** is the default. It is available when
  `navigator.storage.getDirectory` works and `FileSystemFileHandle` has
  `createWritable`.
- **`KeyValuePageStore`** runs over a small `KeyValue` interface. The
  `localStorage` adapter backs the fallback store, and an in-memory adapter
  backs `MemoryPageStore`, which tests and storage-less browsers use. Keys are
  scalar: `a4:page:<name>` holds the text and `a4:page-mtime:<name>` holds the
  modified time. Trash uses `a4:trash:` keys the same way.

`openPageStore()` probes the backends in order. When it settles on OPFS, it
moves any pages it finds in the `localStorage` store into OPFS, under unique
names.

### Autosave: journal, debounce, flush

`PageSession` owns one open page.

1. `update(text)` writes the journal synchronously, then schedules a save:
   600 ms after the last edit, and at most 4 seconds after the first unsaved
   edit.
2. `flush()` saves immediately. It runs when the tab is hidden, on `pagehide`,
   when switching pages, and on Ctrl/Cmd+S.
3. A save writes with the expected revision. The journal entry is cleared only
   if the text has not changed since the save started.
4. Failures are handled by type:
   - Conflict: create a "(conflict …)" copy holding the local text, then hand
     it to the UI to open.
   - Not found: re-create the page under its name or a unique one.
   - Anything else: retry with backoff of 1, 2, 4, 8, 16, then 30 seconds.

Timers are injected so the tests are deterministic.

### Journal and tab liveness

Journal entries use scalar `localStorage` keys per tab and page:

- `a4:draft:<tabId>:<name>` holds the text.
- `a4:draft-base:<tabId>:<name>` holds the base revision.
- `a4:draft-at:<tabId>:<name>` holds a timestamp.

`localStorage` writes are synchronous, so they survive a crash immediately
after a keystroke. Each tab holds a Web Lock, `a4:tab:<tabId>`, for its
lifetime. On startup, recovery skips drafts whose tab lock is still held. In
browsers without Web Locks, it only touches drafts older than 60 seconds.

### Cross-tab notification

A `BroadcastChannel("a4-pages")` carries a single string: the page name that
changed, or an empty string for a library-level change. Receivers re-list the
library. They reload an open page only when they have no unsaved edits to it.

### Serialization policy

No structured record crosses a storage or process boundary:

- Page files are plain Markdown.
- Settings and journal entries use scalar keys.
- The broadcast payload is a bare string.

The project's protobuf-by-default rule is therefore not triggered. A future
index, share format, or richer IPC envelope will be a protobuf message.

### Migration

On the first load after this change, non-empty `a4:text:a` and `a4:text:b`
values are created as pages named from their first non-blank line, sanitized
to a valid unique name. Values that equal the bundled welcome or sample texts
are skipped. `a4:migrated` is set only after the pages are created, and the
old keys are kept.

### UI

The layout becomes three columns: library, desk, and analysis sidebar. On
narrow screens the library collapses into a drawer.

- **Header:** an editable page name and a save-status pill.
- **Compare captions:** a page picker for each slot.
- **Templates and samples:** they create pages instead of replacing text.
- **Download:** saves a `.md` file named from the page name.

## Risks / Trade-offs

- [Safari or other engines without `createWritable`] → Fall back to
  `localStorage` (about 5 MB, roughly 1,000 pages), show that in the footer,
  and move the pages into OPFS once it is available.
- [Browser evicts OPFS under storage pressure] → Request
  `navigator.storage.persist()` on the first edit and show the result.
- [Rename is not atomic] → Copy, then delete, under the page lock. A crash in
  between leaves both copies, a duplicate rather than a loss.
- [`localStorage` journal quota] → Journal entries are one page each and
  cleared after every save. If a journal write throws, autosave saves to the
  store immediately instead.
- [A user edits the same page in two tabs at once] → The conflict copy keeps
  both versions, and the user merges by hand.

## Migration Plan

The upgrade path runs automatically on first load. To roll back, redeploy the
previous Worker. The old version still reads `a4:text:a` and `a4:text:b`,
which migration leaves in place.

## Open Questions

- Should the trash purge entries automatically after some age? Deferred. For
  now the trash is only emptied by the user.
