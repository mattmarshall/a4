# Proposal

## Why

Pages live in the browser's private file system, which users can't browse.
Without a bulk export, the only way to get a library out is to download pages
one at a time. That makes backups, moving to another browser, and handing a
whole stack of pages to an agent tedious.

## What Changes

- Add an "Export all" action to the page library that downloads one `.zip`
  holding every page as `<page name>.md`. Each file's content is exactly the
  page text, inside a dated top-level folder.
- Save pending edits before exporting, so the archive matches what is on
  screen.
- Preserve each page's modified time on its zip entry, and encode file names
  as UTF-8 so names like "Café brief" survive.

Out of scope: exporting the trash, importing a zip, and per-page selection.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `page-export`: adds a requirement for exporting the whole library as a zip
  archive.

## Impact

- New dependency-free zip encoder (`lib/zip.ts`) using the browser's built-in
  `CompressionStream("deflate-raw")`, with Node round-trip tests.
- Library panel gains an "Export all" button. No storage or server changes.
