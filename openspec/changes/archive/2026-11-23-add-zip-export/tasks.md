# Tasks

## 1. Zip encoder

- [x] 1.1 Implement `lib/zip.ts` (CRC-32, DOS times, UTF-8 names, deflate-raw with stored fallback), and verify Node tests that round-trip entries through an independent reader, including non-Latin names, empty files, and stored entries
- [x] 1.2 Verify a generated archive with `unzip -t` and Python `zipfile`

## 2. Export all

- [x] 2.1 Add `exportAll` to the library (flush, list, read, zip) and an "Export all" button in the library panel, and verify in the browser that the download contains every page with its exact text and no trashed pages
- [x] 2.2 Document the export in README, and verify `pnpm check` and `openspec validate add-zip-export --strict` pass

## Workflow follow-up

- Commit and push to deploy, then archive this change.
