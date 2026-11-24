# Design

## Context

See `proposal.md` for why. The state of the code today:

- **Locks:** the OPFS store wraps each operation in `#locked(name)`, a Web
  Locks request on `a4:page:<lowercased name>`. Without Web Locks (and in the
  in-memory store) `noLocks` runs the operation directly.
  `KeyValuePageStore` takes no lock. Its operations make no awaits, so it is
  safe within a tab but not across tabs.
- **Picking a name:**
  - `availableName(store, desired)` lists the store, then
    `nextAvailableName` picks `desired`, `desired 2`, and so on, ignoring
    case. The caller creates afterward, outside any lock.
  - `restore` (OPFS and key-value), `movePages`, and zip import pick from
    their own snapshot of names the same way.
- **Rename (OPFS):** it locks only `from`, creates the target file, then
  removes `from`. On storage that ignores case, a case-only rename "creates"
  the existing file, then removes it.
- **Contract suites:** `lib/persist/store/testing/contract.ts`:
  - `pageFilesContract` runs on the folder store;
  - `pageStoreContract` runs on memory, localStorage, and OPFS (fake).
  - Both assert `revision === revisionOf(text)` and exact byte round trips,
    which `sheetFiles` can't meet: its revisions are the raw file's, and its
    text is normalized.
- **The fake** (`testing/fake-opfs.ts`): it keys children in a `Map` by
  exact name, lists in insertion order, and its `File` snapshots never go
  stale.
- **Copy:**
  - `LibraryPanel` writes "over 1 MiB" and "20,000 entries".
  - `Workbench.importFile` checks `100 * 1024 * 1024` and says "100 MB".
  - Zip import's skip label says "over 1 MB" for `MAX_PAGE_BYTES`.
  - `formatSize` prints KB only, so it can't render a limit.
- **The Welcome text** feeds four entries of
  `components/analysis-copy.snapshot.json` (`welcome@<preset>`).
  `samples.test.ts` requires it to fit Terminal with no wrapped line.

## Goals / Non-Goals

**Goals:**
- Every name a library backend hands out is claimed under the lock for that
  name, and nothing outside the store picks names any more.
- The contract suites run unchanged across every view of storage the app
  uses, including under browser-like fake behavior.

**Non-Goals:**
- A store-wide lock, or new lock names.
- Changing how folder files are named or saved.
- Reworking `formatSize` for page and file sizes.

## Decisions

### 1. `createUnique` on the library store

`PageStore.createUnique(desired, text): Promise<WriteResult>` loops until it
claims a name:
1. Pick a candidate with `nextAvailableName(desired, names)`.
2. Take the lock for that candidate.
3. Re-check inside the lock. If another tab took the name meanwhile, add it
   to `names` and try again.

Each retry rules out one more name, so the loop ends. A cap of 1,000 tries
throws `StoreUnavailableError` rather than spinning.

**The callers:**
- `restore` uses the same private claim helper.
- The session's two relocations and both bootstrap creates call
  `createUnique`, as do `LibraryIndex.create`, the Compare page for B in
  `Workspace`, `movePages`, and zip import.
- Zip import reports a page as renamed when the returned name differs from
  the one it asked for.
- `SameStorePages` gains `createUnique` and drops its `create` override.
- `availableName` is removed. `nextAvailableName` stays, as the pure picker.

**Alternatives:**
- **One lock for the whole library** (`a4:library`): simpler, but it
  serializes every save in every tab. It also adds a lock name that tabs on
  the previous version don't take, so the two versions wouldn't exclude
  each other.
- **Catching `PageExistsError` and retrying in each caller:** this keeps the
  race in eight places instead of one.

### 2. Rename holds both names, in a fixed order

- **Locks:** a rename takes the locks for `from` and `to`, nested, in
  lexicographic order of their lowercased names. Two tabs renaming in
  opposite directions therefore can't deadlock. When the lowercased names
  are equal (a case-only rename), it takes one lock.
- **The clash check** for `to` runs inside both locks.
- **The key-value store** takes an optional `locks`, like OPFS, and wraps
  every operation in the same `a4:page:<lowercased name>` request. The
  localStorage backend gets the platform's locks. The in-memory store keeps
  none, since it is one tab's.

### 3. Case-only renames go through a temporary name

On OPFS, a rename whose names differ only in case moves the page twice:
1. To a temporary page, `<from> (renaming)`, claimed with the helper from
   decision 1.
2. From there to the target.

Each step is the usual copy, then delete. At every moment the text is under
at least one name the library lists. A crash can leave "Notes (renaming)",
which the author sees and can rename, but never loses the page.

**Alternatives:**
- **`FileSystemHandle.move()`:** a true rename, but browser support for it
  in OPFS is uneven. A second code path would also need its own tests.
- **Detecting case-insensitive storage with `isSameEntry`, then skipping the
  delete:** this keeps the page, but leaves it under its old casing.

The key-value store needs neither: its keys are case-sensitive strings, so
its rename is already safe.

### 4. One contract for every view of storage

**Revisions:** the core suite stops asserting `revision === revisionOf(text)`.
It asserts what callers rely on instead:
- the revision from `create` or `write` equals the next `read`'s;
- writing with it succeeds;
- writing with a stale revision is a conflict and changes nothing.

**Text domain:** `pageFilesContract` takes `{ text: "exact" | "sheet" }`.
With `"sheet"`, the cases that need a tab, a CR, or a leading byte-order
mark to round-trip are skipped, and every other case runs unchanged. The
folder suite runs twice:
- on the raw store, with `"exact"`;
- through `sheetFiles`, with `"sheet"`.

**Rules written down** in `types.ts`, on `PageFiles` and `PageSummary`:
- `list` is unordered and lists each page once.
- `size` is the stored bytes.
- `modifiedAt` is the storage's time of the last write.
- The folder list stops at the scan limit.
- An interrupted rename leaves the text under one or both names, or under a
  temporary name.

The CRLF size case is a test in `faithful.test.ts`. The partial folder list
is a test that passes a small limit to `walkFolder`.

### 5. Browser-like fakes

`FakeVolume` takes options:
- **`caseInsensitive`:** children are keyed by their lowercased name, and
  each keeps its first spelling, as macOS and Windows do.
- **`listOrder`:** `"insertion"`, `"reverse"`, or `"sorted"`.
- **`staleSnapshots`:** a `File` remembers the entry's version when it was
  taken, and reading it after a write throws `NotReadableError`.

The defaults keep today's behavior. The OPFS and folder contract suites also
run with all three options on, and that run is what proves decision 3 and
the unordered-list rule.

### 6. Limits in copy come from their constants

- **Formatters:** `components/analysis-copy.ts` gains
  `formatByteLimit(bytes)`. It writes a whole binary unit ("1 MiB",
  "100 MiB") and falls back to KB for anything smaller. Counts use the
  existing `ENGLISH.count`.
- **The import limit:** `MAX_IMPORT_FILE_BYTES` (100 MiB) moves to
  `lib/archive/import.ts` beside `MAX_PAGE_BYTES`, and the Workbench check
  uses it.
- **Zip import's "too large" label** reads `MAX_PAGE_BYTES` through the
  same formatter. `lib/archive` can't import from `components`, so the label
  is built where the report is shown, or takes the formatted limit as a
  parameter.

### 7. Welcome text and its snapshot

**The new lines:**
- "The inspector tracks fill, syntax, repetition, narrative share, and
  tokens."
- "Every page saves itself as a .md file in this browser. Page → New starts
  one."

**The snapshot:**
- The four `welcome@<preset>` entries are regenerated from the new text.
- The test is unchanged: it still compares every entry, so any other
  difference fails.
- Pages already stored keep their text. Only a new library gets the new
  Welcome.

### 8. A11 is a spec-only fix

The test builds 14 rows of "status status r<n>" (28 occurrences) and is
right. The `density-analysis` delta now describes that page, and no code
changes.

## Risks / Trade-offs

- **[Nested locks deadlock]** → A fixed order (sorted lowercased names), a
  single lock when the names match, and a test that runs two opposite
  renames at once over shared fake locks.
- **[Tabs on the previous version]** → Lock names are unchanged, so old tabs
  still exclude new ones per name. An old tab's rename locks only its
  source until it reloads, which is today's behavior.
- **[Stricter fakes find real bugs]** → That's the point. A bug the
  case-insensitive or stale-snapshot run finds in the folder or OPFS store
  is fixed in this change. If one needs more than a local fix, the work
  pauses to ask.
- **["(renaming)" pages after a crash]** → Visible and recoverable, and
  preferable to a page that vanishes. It happens only if the tab dies
  between the two steps of a case-only rename.
- **[Snapshot churn hides a copy regression]** → Only the four `welcome@*`
  entries may change. The task checks the diff touches nothing else.

## Migration Plan

- **No data migration:** stored formats, keys, and lock names are unchanged.
- **Ship and revert:** it ships with a normal deploy, and reverting is a
  revert of the commit.

## Implementation Notes

- **The claimed action checks the name itself.** The design's
  `taken(name)` callback had a gap: without Web Locks it re-checked
  asynchronously, so two calls in one tab could both pass the check. The
  contract's two-tab test caught this on the memory store. The fix:
  - The action that `claimName` runs under the lock checks the name and
    throws `PageExistsError`, and `claimName` moves on to the next variant.
  - In the key-value store, the check and the write make no await, so they
    are atomic within a tab even without locks.
  - OPFS relies on Web Locks, which every browser with OPFS has.
- **The contract takes `tabs`.** `pageStoreContract(label, make, { tabs })`
  gets two stores over one storage and one set of locks for the race cases:
  two creates at once, restore against create, rename against create, and
  opposite renames. Every library run supplies it.
  - `FakeLocks`, in `lib/platform/testing/fakes.ts`, models Web Locks: one
    holder per name, granted in request order.
  - The rename race test fails if OPFS goes back to locking only the
    source, as checked during the work.
- **The browser-like fake reproduced S6.** The OPFS contract with
  `caseInsensitive` on failed "rename to a case variant" before the
  temporary-page fix, then passed after it. The folder runs, raw and through
  `sheetFiles`, found no bugs under the stricter options.
- **The folder list's limit is an option.** `FolderPageFiles` takes
  `scanLimit` (default `SCAN_ENTRY_LIMIT`), so a test can show that `list`
  itself stops where the scan stops.
- **The zip import label** reads `MAX_PAGE_BYTES` inside `lib/archive`, since
  `describeImport` writes its copy there and lib can't import from
  components. A test pins "over 1 MiB".
- **The Welcome wording** is "Page → New starts one.", which keeps the line
  at 77 characters. The design's "starts another" would have wrapped.
- **Two records moved with the Welcome text:**
  - The four `welcome@*` copy-snapshot entries came out identical, so the
    snapshot didn't change.
  - The `analyze()` golden record (`lib/analysis/testing/golden.json`)
    changed only the Welcome page's character, ink, term, and repetition
    numbers. Every verdict stayed Balanced, and the test's header records
    the change.
  - Libraries that already exist keep their stored Welcome page.
- **Manual pass in the production preview:**
  - A new page was named "Untitled 2" beside the existing "Untitled".
  - Renaming "notes" to "Notes" left one file, `Notes.md`, with its text.
  - Back-to-back "+ New page" clicks in two tabs made "Untitled 2" and
    "Untitled 3".
  - The folder notes weren't checked in the browser, because opening a
    folder needs the system's folder picker. Their formatter and the import
    label are covered by unit tests.
