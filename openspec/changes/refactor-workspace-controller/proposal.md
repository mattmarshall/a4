# Proposal

## Why

`components/useLibrary.ts` (977 lines) and `components/Workbench.tsx`
(967 lines) hold most of A4's behavior: pages, folders, sessions, layout,
shortcuts, scoring, Fit to page, and file I/O, all inside React hooks. None
of it runs under the test runner. The review (`docs/tech-debt-review.md`
U1–U5, U8–U13, S8–S10) traced several bugs to this:
- state kept in four places;
- refs used to dodge stale closures;
- module-level startup state;
- effects with suppressed dependencies.

New features (a CLI, a server backend, more plugins) need this logic outside
React.

## What Changes

- **Platform ports:** `lib/platform/` holds `Clock`, `Locks`, `KeyValue`,
  `RandomId`, `HandleStore`, `TabRegistry`, and `Channel`.
  - Browser adapters sit in one place.
  - Fakes for tests sit beside them, reusing `FakeScheduler`.
  - No other module reads `Date.now`, `crypto`, `indexedDB`,
    `navigator.locks`, `localStorage`, or `BroadcastChannel` directly.
- **`Workspace`** is a plain TypeScript controller in `lib/workspace/`, and
  replaces the module-level `boot()`.
  - It takes injected ports and a store opener.
  - It owns the tab lock, recovery, and migration.
  - It exposes `subscribe`, `getSnapshot`, and `dispose`, and emits typed
    `WorkspaceNotice`s instead of English strings.
  - Startup runs once per tab, can be retried after a failure, and flushes
    sessions on `dispose`.
- **`SlotController` ×2:** the only owner of a slot's ref, text, status,
  and session.
  - Typed by ref kind, with no `AnySession` casts.
  - Commands use the `SlotRequests` tickets from fix-review-bugs.
  - It keeps the rule that a page is open in one slot at a time, and the
    follow-copy behavior.
- **`LibraryIndex`:** page and trash lists, every library action,
  import/export, and `LibraryEvent`s over the channel.
- **`FolderIndex`:** reacts to the folder connection.
  - On connect: recover, scan, watch, and reopen remembered files.
  - On leaving `connected`: stop the watcher and close file sessions with
    their drafts kept.
  - It also owns the scan state and the unreadable-file cache.
- **Folder internals are split:**
  - `FolderConnection` becomes a registry (stable ids and handle
    persistence) and an access state machine (permissions).
  - `forget()` reuses `recoverDrafts`.
  - A `FolderFs` port (`entries`, `stat`, `readBytes`, `writeAtomic`) hides
    the File System Access API from the scan, the watcher, and the store.
- **React adapters:**
  - `useWorkspace()` (built on `useSyncExternalStore`).
  - `useNotices()`, which turns notices into English and a toast tone,
    using `describeError` from fix-review-bugs.
- **Workbench split:**
  - `useLayout`: mode, active slot, panels, focus, zoom, and
    `useMediaQuery` matched to the CSS breakpoints.
  - `useShortcuts`: one Escape priority stack.
  - `SheetStage`: sheets, captions, and pickers. It owns the view and pose
    state, so orbiting no longer re-renders the panels.
  - `Topbar`, with `PageMenu` and `ViewMenu`.
  - `useAnalysis`, `useSemanticLens` (around `ScoreSchedule`), and the
    `FitJob` from fix-review-bugs.
- **`LibraryPanel`:**
  - `open` and `onOpen(ref, slot)` are ref-based, and actions are grouped.
  - Leftover names go: the `sidebar` class, `KEYS.library`, the
    `closeFolder` alias, and the unused `rescanFolder`.

## Capabilities

### New Capabilities

### Modified Capabilities

(None: behavior is unchanged, so `skip_specs` is set.) Every autosave,
folder, library, Compare, focus, and print behavior stays as specified.

## Impact

- **New folders:** `lib/platform/` and `lib/workspace/`.
- **Folder and store code:** `lib/folder/` (connection split, `FolderFs`),
  and `lib/store/folder.ts` (on `FolderFs`).
- **Removed:** `components/useLibrary.ts` (replaced).
- **Split up:** `components/Workbench.tsx`.
- **New components:** `components/workspace/*` (adapters), `SheetStage`,
  `Topbar`, menus, and hooks.
- **Updated:** `components/LibraryPanel.tsx`, and `app/globals.css` (print
  hides chrome by `data-print`, not the `sidebar` class).
- **Tests:** `Workspace`, `SlotController`, `LibraryIndex`, and
  `FolderIndex` run in Node with fakes. The UI tests suite grows from 0 to
  covering open, edit, conflict, folder connect and disconnect, reload
  restore, and Compare.

## Out of scope

- Moving files outside `lib/workspace/` and `lib/platform/`:
  refactor-lib-layout.
- Model plugin changes: refactor-model-plugins.
- Element internals: refactor-sheet-element.
