# Proposal

## Why

`docs/tech-debt-review.md` has one list left, "Left for a later round". Each
item is small, and together they finish the review:

**Four smaller copies.**
- **The IndexedDB helpers.** `lib/platform/plugin-store.ts` and
  `lib/platform/handle-store.ts` each open a database, run a request in a
  transaction, and list every entry, in near-identical code.
- **Ed25519 key handling.** `cli/plugin.ts`, `scripts/build-example-plugins.ts`,
  and `lib/models/testing/packages.ts` each generate or read a key, take its
  raw 32-byte public key from a JWK, and sign with `node:crypto`. Each does
  it its own way.
- **The poll loops.** `LibraryPoller` (`lib/workspace/library-poller.ts`) and
  `FileWatcher` (`lib/persist/folder/watch.ts`) repeat the same timer,
  stop, visibility check, and guard against a second tick starting while one
  runs.
- **Copy written inline.**
  - The shared view writes its pill ("Shared · not saved"), its banner's
    note, and its fallback error inline.
  - The served library's switch, Connect form, and connect-link error are
    inline in `LibrarySwitch.tsx`, `Workbench.tsx`, and `useServeLink.ts`.
  - The reasons a served library can't be used are written only for the
    notice, in `components/workspace/notices.ts`.

**The Connect form closes when the server is down.** Connecting by hand
saves the address and token before A4 knows the server answers. When it
doesn't, the form closes, a notice explains why, and the switch now offers
an `a4 serve` that can't be used. A mistyped token is remembered the same way.

**A shared page is the empty slot with a label.** A share link's page has
`ref: null` like an empty slot, and the stage tells them apart by whether
`label` is null. `SheetStage.tsx` and `Topbar.tsx` each repeat that check.

## What Changes

- **One IndexedDB helper.** `lib/platform/idb.ts` opens a database with its
  object stores, runs one request in a transaction, and lists a store's
  entries. `IdbPluginStore` and `IdbHandleStore` use it. Their databases,
  stores, and keys stay as they are.
- **One Ed25519 key module for Node.** `lib/models/signing-key-node.ts`
  generates a key, reads a PEM key, writes one only if the file doesn't
  exist, gives the raw public key, and signs. The CLI, the example build, and
  the test packages use it. What `a4 plugin keygen` and `pack` print, accept,
  and refuse is unchanged.
- **One poll loop.** `lib/persist/autosave/poll.ts` holds the timer, stop,
  the visibility check, and the guard against overlapping ticks.
  `LibraryPoller` and `FileWatcher` keep only what each compares. Their
  intervals stay at 2 seconds and 1 second.
- **The copy moves to `*-copy.ts`.**
  - `share-copy.ts` gains the shared view's pill, its banner note, and its
    fallback error.
  - A new `components/served-copy.ts` holds the library switch's words, the
    Connect form's hint and errors, the connect-link error, and one sentence
    for each reason a served library can't be used. The notice and the
    Connect form share those sentences.
- **The Connect form checks before it remembers.**
  - Connecting by hand reaches the server first.
  - If A4 can't use it, the form stays open and says why and what to do: not
    running, token refused, another version, or an answer A4 can't read.
    Nothing is remembered, and the library shown doesn't change.
  - Only a server that answers is remembered and shown.
  - The connect link `a4 serve` prints still remembers its address and token
    even when the server is down, and explains why in a notice, as it does
    today.
- **A shared page has its own type.** The stage's slots are a `StageSlot`:
  a workspace `SlotSnapshot`, or a `SharedSlot`. Every slot carries a
  `kind`: `empty`, `library`, `file`, or `shared`. The stage checks
  `kind === "shared"` instead of a null `ref` with a label.
- **The review is done.** `docs/tech-debt-review.md` records the round under
  "Taken up by `finish-tech-debt-review`", and its "Left for a later round"
  list is removed.

### Out of scope

- **Changing the stores' formats.** No IndexedDB database, object store,
  key, or version changes.
- **Changing the CLI's key formats.** Keys stay PKCS #8 PEM, and the commands
  keep their output, exit codes, and refusals.
- **Changing what the pollers notice, or how often.**
- **Changing what the connect link does** when the server is down.
- **Moving other inline copy,** in the Seal dialog, the folder section, or
  the page menus.
- **A shared page in the workspace.** Shared pages stay in the stage and
  never enter `Workspace` or its snapshot.
- **New debt.** Anything a review finds after this lands starts a new review.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `served-library`: connecting by hand from the Connect form checks the
  server first. When A4 can't use it, the form stays open with the reason
  and what to do, and nothing is remembered.

## Impact

- **Platform:** a new `lib/platform/idb.ts`. `plugin-store.ts` and
  `handle-store.ts` are rewritten on it.
- **Models:** a new Node-only `lib/models/signing-key-node.ts`. The
  dependency rules let `cli/` import it.
- **Persist and workspace:** a new `lib/persist/autosave/poll.ts`, used by
  `library-poller.ts` and `watch.ts`. The workspace's `connectServed` gains
  the form's check, and its slot snapshots gain `kind`.
- **CLI and scripts:** `cli/plugin.ts` and `scripts/build-example-plugins.ts`
  use the key module.
- **UI:**
  - `components/served-copy.ts` is new, and `share-copy.ts` and `notices.ts`
    gain or share its sentences.
  - `LibrarySwitch.tsx`, `useServeLink.ts`, `Workbench.tsx`,
    `SharedBanner.tsx`, `useSharedView.ts`, `Topbar.tsx`, `SheetStage.tsx`,
    and `stage.ts` are rewired.
- **Docs:** the README's "Served library" says what the Connect form does
  when the server can't be used. The tech debt review closes.
- **No proto, storage, or bundle changes.** `pnpm check:bundle` must still
  pass.
