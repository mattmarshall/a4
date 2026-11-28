# Tasks

## 1. The library's notices and confirmations

- [x] 1.1 Add `libraryNotices`, `libraryConfirm`, `libraryActions.exportPages`, and `libraryActions.importFile(name)` to `components/library-copy.ts` (design decision 1), moving each sentence word for word from `Workbench.tsx`, `LibraryPanel.tsx`, and `menus.tsx`, except that emptying the trash says "1 page" or "N pages"; use them at every call site; verify `components/library-copy.test.ts` pins each sentence as it reads today, plus the trash confirmation for 1 and for 3 pages, and that none of the moved strings is left inline in those three files
- [x] 1.2 Export `runReported` from `lib/workspace/index.ts`, and report Export all and an import through it (design decision 3), with the export's action covering both building the archive and saving the file; verify `library-copy.test.ts` composes "Couldn’t export the pages: The browser didn’t allow access." and "Couldn’t export the pages: Storage isn’t ready yet." through `runReported`, and "Couldn’t import “Brief.zip”: …" for an import, and that `pnpm typecheck` passes and no "Export failed" is left in `components/`

## 2. The desk, the plugins, and the view

- [x] 2.1 Add `sealedNotice(verdict, label)` to `components/desk-copy.ts` and `NO_WEBGPU` to a new `components/view-copy.ts`, and use both in `Workbench.tsx`; verify new `components/desk-copy.test.ts` and `components/view-copy.test.ts` pin both seal notices (with a label and with none) and the WebGPU notice, and `pnpm lint:deps` passes
- [x] 2.2 Add `penResultNotice(name, result)` and `modelFailed(name, why)` to `components/plugin-copy.ts`, and use them in `Workbench.tsx`'s pen result and `useModelLens.ts`'s two failures, with `describeError` as the reason; verify `components/plugin-copy.test.ts` pins the "fits" and "still over" sentences and both `modelFailed` forms (a name, and "Model" without one)

## 3. One describer

- [x] 3.1 Replace the remaining hand-made reasons with `describeError` from `@/lib/workspace`: the Models panel's update check and remove, the install dialog's two errors (removing its `message` helper), and `useModels`' start and download errors; verify `grep -rnE "instanceof Error \? [a-z]+\.message : String" components` finds nothing, `pnpm typecheck` and `pnpm lint:unused` pass, and a model error's message reads as before (an existing `ModelError` test through `describeError`)

## 4. On localhost

- [x] 4.1 On localhost, verify the moved notices read as before: create a page, copy its text, export all, and move a page to the trash; then, with `window.confirm` stubbed in the console to record its message, verify emptying a trash of 2 pages asks "Permanently delete 2 pages in the trash? This can’t be undone.", and clean up the pages made for the check

## 5. The review

- [x] 5.1 In `docs/tech-debt-review.md`, after the 2026-11-27 round, add a short section saying a scan after the review found the inline notices and the hand-made error text, and `finish-ui-copy` took them up; verify the section names the change and says no item is left open

## 6. Integration

- [x] 6.1 Run `pnpm check` (lint, tests, typecheck, proto check, build, bundle check, element build) and verify it passes

## Workflow follow-up

- Commit, push, and watch CI and the deploy to a4.marsh.build.
- Archive the change, syncing the `page-export` delta into the main spec.
