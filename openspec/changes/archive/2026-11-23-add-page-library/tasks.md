# Tasks

## 1. Page store contract and backends

- [x] 1.1 Define the `PageStore` contract, branded `PageName` and `Revision` types, typed errors, name validation, and cyrb53 revisions in `lib/store/`, and verify unit tests for name rules and revision stability
- [x] 1.2 Implement `KeyValuePageStore` with `localStorage` and in-memory adapters, and verify the shared contract suite passes against both
- [x] 1.3 Implement `OpfsPageStore` (`a4/pages`, `a4/trash`, `.md` only, lock + verify + `createWritable`), and verify the shared contract suite passes against an in-memory OPFS fake, including an interrupted write
- [x] 1.4 Implement `openPageStore()` backend selection and fallback-to-OPFS page migration, and verify unit tests for migration and in-browser selection of OPFS (the localStorage and memory fallbacks are not exercised in a browser without OPFS)

## 2. Autosave and recovery

- [x] 2.1 Implement the tab journal (scalar keys, per tab and page) and verify unit tests for set, clear, and listing other tabs' drafts
- [x] 2.2 Implement `PageSession` (debounce 600 ms, max wait 4 s, flush, status, retry backoff, conflict copy, recreate on not found) with injected timers, and verify unit tests for each spec scenario
- [x] 2.3 Implement startup recovery and slot migration, and verify unit tests for apply, recovered copy, skip-live-tab, and migration naming

## 3. Workbench integration

- [x] 3.1 Build the library panel (list, search, new, rename, duplicate, trash, restore, delete, empty trash, storage footer), and verify in the browser
- [x] 3.2 Wire the open page and compare slots to sessions, add the header name and save status, Ctrl/Cmd+S, and flush on hide, and verify in the browser that edits survive a reload
- [x] 3.3 Make templates and samples create pages, switch Download to `.md`, and add cross-tab refresh, and verify in the browser with two tabs
- [x] 3.4 Verify OPFS contents in the browser (`a4/pages/*.md` equals the page text) and persistent-storage status

## 4. Documentation and integration

- [x] 4.1 Update README and docs/concept.md for the library, storage layout, and backends, and verify the documented layout matches OPFS
- [x] 4.2 Verify integration: `pnpm check` passes and `openspec validate add-page-library --strict` passes

## Workflow follow-up

- Push to `main` so GitHub Actions deploys, then check https://a4.marsh.build.
- Archive this change after the deploy is verified.
