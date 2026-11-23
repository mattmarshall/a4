# Proposal

## Why

Export produces a zip of `.md` pages, but there is no way back in. Users need
to restore a backup, move a library to another browser, or bring in pages
written elsewhere, such as an `AGENTS.md` or a folder of prompt files zipped up.

## What Changes

- Add "Import .zip" to the page library. Every `.md` and `.txt` file in the
  chosen archive becomes a page named after the file. Folders inside the
  archive are ignored, and text is normalized the same way as pasted text.
- Never change existing pages:
  - A file whose name and text match an existing page is skipped, so
    re-importing an export creates no duplicates.
  - A file whose name matches but whose text differs is imported under a
    unique name ("Brief 2").
- Skip entries that are not pages:
  - folders, hidden files, and macOS `__MACOSX/` metadata
  - other file types and binary content
  - encrypted, corrupt, or oversized entries
- Refuse archives that are too large or use unsupported formats, before
  inflating anything.
- Report what happened: imported, renamed, unchanged, and skipped counts.

Out of scope: choosing which entries to import, replacing existing pages,
importing loose `.md` files without a zip, and drag-and-drop.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `page-library`: adds requirements for importing pages from a zip archive.

## Impact

- New dependency-free zip reader (`lib/unzip.ts`), using the platform's
  `DecompressionStream("deflate-raw")`, with tests against archives produced by
  Info-ZIP `zip`, macOS Finder (`ditto`), and A4's own exporter.
- New `lib/import.ts` that applies the import rules through the `PageStore`
  contract, so it works on every backend.
- Library panel gains an "Import .zip" button.
