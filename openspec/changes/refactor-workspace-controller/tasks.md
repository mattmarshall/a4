# Tasks

## 1. Platform ports

- [ ] 1.1 Add `lib/platform/` (`Clock`, `Locks`, `KeyValue`, `RandomId`, `HandleStore`, `TabRegistry`, `Channel`, browser adapters, fakes), and inject them in the store, autosave, and folder modules. Verify that the existing tests pass, and the dependency-cruiser rule "no browser globals outside `lib/platform`" passes

## 2. Folder split

- [ ] 2.1 Split `FolderConnection` into `FolderRegistry` and `FolderAccess`, make `forget` reuse `recoverDrafts`, and add the `FolderFs` port with browser and `node:fs` adapters. Verify that the connection, scan, and watch tests pass on both adapters

## 3. Workspace controller

- [ ] 3.1 Add `Workspace` (start, dispose, snapshot, notices, `Result` commands) with `LibraryIndex`. Verify with Node tests: start runs once and retries after a failure; create, rename, trash, and restore; cross-tab events; dispose flushes
- [ ] 3.2 Add `SlotController` ×2 with `SlotRequests` tickets, typed by ref kind. Verify with Node tests: open, edit, swap, the one-slot rule, follow-copy with keys typed during the copy, and a conflict copy
- [ ] 3.3 Add `FolderIndex` (connect, scan, watch, reopen remembered files in either slot, and tear down on leaving `connected`). Verify with Node tests against the fake folder: reconnect reopens a file in B, and a deleted folder tears down

## 4. React adapters and Workbench split

- [ ] 4.1 Add `useWorkspace` and `useNotices`, and switch the Workbench from `useLibrary`, then delete `useLibrary`. Verify that `pnpm check` passes, and in the browser: library actions, Compare, folder open with a stand-in folder, and reload restore
- [ ] 4.2 Split the Workbench into `useLayout`, `useShortcuts`, `SheetStage`, `Topbar` and the menus, `useAnalysis`, and `useSemanticLens`, with no lint suppressions left. Verify in the browser: shortcuts (F, Escape order, Ctrl+S), and orbiting a sheet re-renders neither the library nor the inspector (React profiler, or a render counter in dev)
- [ ] 4.3 Make `LibraryPanel` ref-based (`open`, `onOpen(ref, slot)`, grouped actions) and remove the leftovers (`sidebar` class, `KEYS.library` name, `closeFolder` alias, `rescanFolder`). Print hides chrome by `data-print`. Verify in the browser, and with print to PDF (one A4 page of text)

## 5. Integration

- [ ] 5.1 Run `pnpm check`, `pnpm lint`, and `openspec validate refactor-workspace-controller --strict`. In the production preview, check autosave across a reload, a conflict between two tabs, and a folder file edit and reconnect

## Workflow follow-up

- Commit and push to deploy, then archive this change.
