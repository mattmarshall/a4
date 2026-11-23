# Tasks

## 1. Zip reader

- [x] 1.1 Implement `lib/unzip.ts` (EOCD scan, central directory, stored and deflate, data descriptors, UTF-8 and legacy names, CRC check, size and count guards), and verify tests that read A4 exports and committed fixtures from Info-ZIP (forced data descriptors), macOS `ditto`, and Python `zipfile`
- [x] 1.2 Verify guards with tests for a non-zip file, a Zip64 marker, too many entries, too much declared data, and an entry that inflates past its declared size

## 2. Import rules

- [x] 2.1 Implement `lib/import.ts` (page files only, name from basename, normalization, unchanged and renamed handling, skip reasons, report), and verify tests for every page-library import scenario through the `PageStore` contract

## 3. Workbench

- [x] 3.1 Add an "Import .zip" button to the library panel with a file picker and a result message, and verify in the browser by importing an export and a Finder-style archive

## 4. Documentation and integration

- [x] 4.1 Document import in README, and verify `pnpm check` and `openspec validate add-zip-import --strict` pass

## Workflow follow-up

- Commit and push to deploy, then archive this change.
