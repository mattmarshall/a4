# Design

## Context

- **Prerequisites:** fix-review-bugs lands first, with `SlotRequests`,
  `pendingReopen`, `FitJob`, `ScoreSchedule`, and `describeError`.
  refactor-typed-contracts lands first, with `RelocationPolicy`, typed
  settings, and `LibraryEvent`.
- **What `useLibrary` holds today:** startup, sessions, the channel, the
  folder connection, scanning, watching, and notices, all in one hook, with
  12 refs.
- **What the Workbench holds today:** 24 `useState`s and the full markup.

## Goals / Non-Goals

**Goals:**
- All library, folder, and slot behavior runs in Node tests with fakes.
- React only renders a snapshot and calls commands.
- Orbiting or folding one sheet re-renders only that sheet's stage.

**Non-Goals:**
- New behavior.
- A UI test framework. The logic moves out of React instead.

## Decisions

### 1. A controller plus `useSyncExternalStore`, not React context and reducers

- **The controller is plain TypeScript.** Its state is an immutable
  snapshot replaced on each change. `useWorkspace(selector)` subscribes with
  `useSyncExternalStore`, which gives tearing-free reads under concurrent
  rendering.
- **Tests:** they drive the controller directly and read snapshots.
- **Alternative considered:** a reducer with context. It would keep the
  logic in React's lifecycle and still need effects for asynchronous work.
  **Rejected.**

### 2. The snapshot

```ts
interface WorkspaceSnapshot {
  status: "starting" | "ready" | { failed: string };
  storage: StorageInfo;
  library: { pages: readonly PageSummary[]; trash: readonly TrashEntry[] };
  slots: Record<Slot, SlotSnapshot>;          // SlotSnapshot = { ref: LibraryRef; … } | { ref: FileRef; … } | { ref: null }
  folder: FolderSnapshot;                     // state + files + partial + scanning
}
```

- **Notices** go through a separate `subscribeNotices`, so they are never
  part of the state.
- **Text:** slot text lives in the `SlotController`. Typing calls
  `slot.edit(text)`, which updates the session synchronously and publishes
  a snapshot. The latest text is always the controller's, so there is no
  `latestText` ref.

### 3. Commands

- **Commands return typed results:** `Promise<Result<T, WorkspaceError>>`,
  where `WorkspaceError` is a union of store, folder, and model errors.
- **The UI turns results into notices in one place:** `useNotices`, using
  `describeError`. Nothing throws to the UI.

### 4. Startup and disposal

- **Startup:** `createWorkspace(ports)` returns a workspace whose `start()`
  is idempotent per tab. It takes the tab lock, recovers, migrates, and
  makes sure the Welcome page exists. A failed start can be retried.
- **`dispose()`** flushes every session, stops the watcher, unsubscribes
  the folder state, and closes the channel. The React adapter calls it on
  unmount. Navigating to `/why` and back keeps data safe.
- **StrictMode and hot reload:** the adapter keeps one workspace per tab in
  a `WeakRef` registry, keyed by the tab id.

### 5. Folder split

- **`FolderRegistry`:** stable ids by `isSameEntry`, handle persistence in
  the `HandleStore` port, and `forget(id)`.
- **`FolderAccess`:** a permission state machine
  (`none | unsupported | connecting | reconnect | not-found | connected`).
- **`FolderIndex`:** in the workspace. It reacts to state changes, and on
  leaving `connected` it tears down sessions and the watcher (review U12).
- **`FolderFs`:** the File System Access adapter, plus a `node:fs` adapter
  for tests and a future CLI.

### 6. Workbench split

| Piece | Owns |
| --- | --- |
| `useLayout` | mode, active slot, panels, focus, zoom (via `useSetting`), breakpoints via `matchMedia` |
| `useShortcuts` | F, Escape stack (menu → pose panel → focus), Cmd/Ctrl+S |
| `SheetStage` | the sheets, captions, slot pickers, view and pose state (local) |
| `Topbar`, `PageMenu`, `ViewMenu`, `HelpMenu` | top-bar markup and commands |
| `useAnalysis` | `analyze` for the open slots, memoized by text and preset |
| `useSemanticLens` | `ScoreSchedule` and plane state |
| `FitJobChip` | the progress chip from fix-review-bugs |

## Risks / Trade-offs

- **[A large move touches the most-used code]** → The work goes in steps,
  and each keeps `pnpm check` and the browser checks green:
  1. ports;
  2. the workspace behind the old hook API;
  3. switching the Workbench to `useWorkspace`;
  4. splitting the Workbench;
  5. deleting `useLibrary`.
- **[Autosave guarantees]** → The existing autosave and folder tests run
  unchanged. New workspace tests cover journal-before-save, follow-copy,
  and the pending reopen.
- **[Print depends on chrome classes]** → Print hides by `data-print="hide"`.
  A print-to-PDF check is in the tasks.

## Migration Plan

No stored data changes: the same keys, journal, OPFS, and IndexedDB.
Reverting restores the old hook.
