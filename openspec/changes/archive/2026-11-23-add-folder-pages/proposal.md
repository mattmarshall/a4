# Proposal

## Why

A4 exists to shape the context an agent reads. That context lives in
repositories, as `AGENTS.md`, `CLAUDE.md`, and skill files. A4 pages live only
in the browser's private storage, though, so a page reaches a repository only
by Copy or Download and a paste. After that, the page and the file the agent
reads drift apart.

The concept doc already names a user-chosen folder as a next storage backend.
Page storage sits behind one typed contract with shared contract tests, so a
folder backend can be added without changing how editing works.

## What Changes

- **Open a folder.** In Chromium browsers, **Open folder…** in the Pages panel
  asks for read and write access to a local folder, such as a repository.
  - A4 remembers the folder.
  - After a reload, it shows **Reconnect** when the browser asks for access
    again.
- **The folder's context files are listed.**
  - **Context files:** `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `SKILL.md`,
    Claude agents and commands, and Copilot and Cursor rules, at any depth.
    Each shows its rows used out of 60 and is marked when it runs over a page.
  - **Other Markdown:** listed in a collapsed group.
  - **Skipped:** `.git`, `node_modules`, and build output.
- **A file opens as a page.**
  - It gets the same sheet, metrics, lenses, 3D rendering, and Compare as a
    library page.
  - The header shows the file's path. Files can't be renamed from A4.
- **Edits save to the file through autosave.**
  - Lines the author didn't touch stay byte-for-byte the same: tabs, CRLF line
    endings, a byte-order mark, and the final newline.
  - A file longer than one page is never cut short.
- **Changes made outside A4 are respected.**
  - If a file changes on disk (an editor, an agent, or `git checkout`) and A4
    has no unsaved edits, A4 reloads it.
  - If A4 has unsaved edits, A4's version is saved as a library page instead
    of overwriting the file.
- **Copies go to the library, never the folder.** This covers conflict copies,
  text saved when the file was deleted on disk, recovered drafts, Fit to page
  results, and duplicates.
- **A4 never renames or deletes files.** It creates a file only when asked:
  - **New file in folder** creates a new file.
  - **Save to folder** writes a library page as a new file.
  - Neither one overwrites an existing file.
- **The storage contract splits in two.**
  - **Core operations** (list, read, create, write) are shared by every
    backend.
  - **Library operations** (rename, trash, restore, purge) are implemented
    only by library backends.
- **Nothing is uploaded.** Files are read and written on the device. No
  network request carries their text.

## Capabilities

### New Capabilities
- `folder-pages`: opening a local folder; listing its context files;
  editing them as pages with faithful saves; handling changes on disk;
  where copies go; creating files; reconnecting after a reload.

### Modified Capabilities
- `page-storage`: the typed contract splits into core operations that every
  backend implements, and library operations that only library backends
  implement.
- `autosave`: when the file behind a folder page is deleted on disk, unsaved
  text is saved as a library page, and the file is not recreated.
- `page-library`: for a folder file, the current page header shows the
  file's path, which can't be edited.
- `page-comparison`: either Compare slot can show a folder file.

## Impact

- **Storage:**
  - `lib/store/`: the core and library interfaces, the contract suite split
    to match, and a new folder backend.
  - `lib/store/testing/`: a fake directory handle that models a user folder.
- **New `lib/folder/`:** the folder scan and context-file patterns, the
  faithful-save line mapping, and handle persistence in IndexedDB.
- **Autosave:** in `lib/autosave/`, page sessions and draft recovery take a
  separate store for copies.
- **UI:**
  - `components/useLibrary.ts`: slots hold page references (a library name
    or a folder path) instead of names.
  - `components/LibraryPanel.tsx`: the folder section.
  - `components/Workbench.tsx`: the header and the Page menu.
  - `components/ComparePanel.tsx`: the caption pickers.
- **Docs:** README and `docs/concept.md`.
- **No other changes:** no new dependencies, no Worker changes, and no new
  network requests.

## Out of scope

- **Other browsers:** folders in Safari and Firefox, which lack a folder
  picker. The library works there as before.
- **Several folders:** more than one folder open at once, or a list of recent
  folders.
- **Managing files:** renaming, moving, or deleting files, and editing files
  other than Markdown.
- **Ignore files:** following `.gitignore`. The scan uses a fixed list of
  skipped folders.
- **Git:** showing status or diffs, committing, or switching branches.
- **Bulk copies:** exporting the whole library into a folder, or importing a
  whole folder into the library.
- **Related ideas:** reams, and correct cell widths for wide characters.
