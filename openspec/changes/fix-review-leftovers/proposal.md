# Proposal

## Why

The eight changes planned in `docs/tech-debt-review.md` shipped. Seven findings
remain open or partly done, because the plan never assigned them or a change
covered only part of one.

Two of them can lose or misplace pages today:
- **S6:** a case-only rename on case-insensitive storage writes the new name
  over the old file, then deletes it.
- **S7:** two tabs can pick the same free name, because a name is picked and
  then created in separate steps.

The rest are test gaps, copy that drifts from code, and a spec that
disagrees with its test. Closing them all makes the review fully done.

## What Changes

- **Name claims are atomic (S6, S7):**
  - The library backends get one operation that picks a free name and
    creates the page under the store's lock.
  - Eight callers stop listing names first and creating after: the six the
    review found, plus zip import and the move from the localStorage
    fallback, which pick names the same way.
  - `rename` holds the locks for both names.
  - `restore` picks its name inside the lock.
  - A case-only rename keeps the page on case-insensitive storage.
  - The localStorage and in-memory backend serializes its operations across
    tabs with the same Web Locks names the OPFS backend uses.
- **The store contract covers what sessions use (S5):**
  - The core contract suite also runs on `sheetFiles`, the folder store as
    autosave sessions see it.
  - The contract's unwritten rules are written down and tested: list order,
    what `modifiedAt` and `size` mean, when a list can be partial, and what
    a crash during rename can leave behind.
- **Fakes behave like browsers (S12):** the fake file system can treat names
  as case-insensitive, list entries in a different order, and fail reads from
  a stale `File` snapshot, as browsers do. The contract runs under these
  options.
- **UI copy reads its limits (U12):**
  - The library's "too large" note, the folder's partial-list note, and the
    zip import size check take their numbers from the constants that enforce
    them.
  - The import file-size limit moves into `lib/archive` beside the other
    import limits.
  - The copy says "100 MiB", since the check has always been 100 × 1,024 ×
    1,024 bytes.
- **Welcome text (U13):** the Welcome page stops saying "sidebar" and "Use
  New", and names the inspector and Page → New instead. Its four entries in
  the analysis-copy snapshot are updated, and every other entry stays the
  same.
- **Spec matches test (A11):** the repeated-term scenario in
  `density-analysis` describes the page the test uses, so it names 28
  occurrences, not 14.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `page-storage`:
  - The typed contract requirement covers `sheetFiles` and states the
    contract's rules.
  - A new requirement makes name claims (create under a unique name,
    rename, restore) atomic across tabs, and safe on case-insensitive
    storage.
- `density-analysis`: the repeated-term scenario under "Actionable findings"
  names the count the page actually has.

## Impact

- **Storage:** `lib/persist/store/`: `names.ts`, `types.ts`, `opfs.ts`,
  `key-value.ts`, and `testing/` (the contract and the fake).
- **Callers of the new create:**
  - `lib/persist/autosave/session.ts` and `bootstrap.ts`;
  - `lib/workspace/library-index.ts` and `workspace.ts`;
  - `lib/persist/store/open.ts`;
  - `lib/archive/import.ts`.
- **Folders:** `lib/persist/folder/faithful.ts` is tested through the
  contract. Its behavior changes only if the contract finds a bug.
- **UI and content:**
  - `components/LibraryPanel.tsx` and `components/Workbench.tsx`;
  - `lib/archive/import.ts`;
  - `lib/content/welcome.ts` and `components/analysis-copy.snapshot.json`.
- **Specs:** `openspec/specs/page-storage` and
  `openspec/specs/density-analysis`.
- **Unchanged:** stored formats, lock names, and the channel. A tab on the
  previous version still interoperates, though only the new version takes
  both locks for a rename.
- **Out of scope:**
  - Copy beyond these sentences: no wider copy review of the Welcome page.
  - Folder-file renames: folders still never rename.
  - Locks for browsers without Web Locks, where the store stays unlocked as
    today.
  - Byte formatting elsewhere: the Models panel keeps its decimal megabytes
    for download sizes.
