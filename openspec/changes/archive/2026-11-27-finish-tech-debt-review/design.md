# Design: finish-tech-debt-review

## Context

See proposal.md for why, and the spec delta for the Connect form's
behavior. The code this builds on:

| Piece | Where | What changes |
| --- | --- | --- |
| The IndexedDB stores | `lib/platform/plugin-store.ts` (database `a4-plugins`, stores `plugins` and `files`) and `lib/platform/handle-store.ts` (database `a4`, store `folders`). Each has its own `#open`, `#run`, and entry listing | Both use `lib/platform/idb.ts` |
| Ed25519 keys | `cli/plugin.ts` (`keygen`, `pack`, `rawPublicKey`), `scripts/build-example-plugins.ts` (`signingKey`, the raw key read from a JWK inline), and `lib/models/testing/packages.ts` (`testKey`) | All use `lib/models/signing-key-node.ts` |
| The poll loops | `lib/workspace/library-poller.ts` (every 2,000 ms, lists the pages) and `lib/persist/folder/watch.ts` (every 1,000 ms while a file is watched, stats each file). Each has `#timer`, `#ticking`, `#stopped`, `#schedule`, and the guards at the top of `tick` | Both run on `PollLoop` in `lib/persist/autosave/poll.ts` |
| Shared-view copy | `Topbar.tsx` ("Shared · not saved"), `SharedBanner.tsx` (the "Shown on … as the sender saw it" note, the seal's page prefix), and `useSharedView.ts` (the fallback error) | In `share-copy.ts` |
| Served-library copy | `LibrarySwitch.tsx` (the switch, the Connect form's hint and labels), `Workbench.tsx` (the malformed-address error), `useServeLink.ts` (the bad-link error), and `components/workspace/notices.ts` (each unavailable reason, for the notice only) | In a new `components/served-copy.ts` |
| Connecting by hand | `Workspace.connectServed` saves the setting, then switches. A failure to reach the server becomes a `served-unreachable` notice, and the form closes because `served` is now set | The form checks first, and remembers only on success |
| The shared slot | `useSharedView.ts` builds a `SlotSnapshot` with `ref: null` and a label. `SheetStage.tsx` and `Topbar.tsx` check `ref === null && label !== null` | A `SharedSlot` in the stage's own `StageSlot` type (`shared-slots.ts`), and `kind` on every slot |

## Goals / Non-Goals

**Goals**
- **One copy of each mechanism:** one IndexedDB helper, one key module, and
  one poll loop. Each is tested once, and its users keep only what's theirs.
- **Words in `*-copy.ts`:** the shared view and the served library say
  nothing inline, and the notice and the Connect form share each reason.
- **A Connect that fails changes nothing:** no setting written and no switch
  offered, and the form says why.
- **The type says when a slot is shared:** the stage checks a `kind`, not a
  combination of nulls.

**Non-Goals**
- **No format changes:** IndexedDB names and versions, PEM keys, and poll
  intervals stay as they are.
- **No change to the connect link,** which remembers and notifies as today.
- **No UI tests.** The pieces that decide are pure functions or classes,
  tested under `node --test`. The components render them.

## Decisions

### 1. `lib/platform/idb.ts`: one small database wrapper

```ts
/** An IndexedDB database with fixed object stores, opened on first use. */
export class IdbDatabase {
  constructor(name: string, version: number, stores: readonly string[]);
  /** Run one request in its own transaction; resolves when the transaction completes. */
  run<T>(store: string, mode: IDBTransactionMode, request: (s: IDBObjectStore) => IDBRequest<T>): Promise<T>;
  /** Every key and value in `store`, in one read transaction. */
  entries<V>(store: string): Promise<[string, V][]>;
}
```

- **The upgrade** creates any listed store the database lacks, as both
  stores do today.
- **`IdbPluginStore`** holds `new IdbDatabase(name, 1, ["plugins", "files"])`.
  **`IdbHandleStore`** holds `new IdbDatabase("a4", 1, ["folders"])`. Their
  methods become one line each.
- **The contract test still runs in the browser.** `runInBrowser` checks
  the plugin store against a fresh database, as before. A matching
  `runInBrowser` is added for the handle store's get, set, delete, and
  entries.
- **Alternative:** the `idb` package. Rejected: it adds a dependency for
  about 40 lines, and its own promise wrapper.

### 2. `lib/models/signing-key-node.ts`: Ed25519 keys in Node

```ts
/** An Ed25519 key that can sign, with its raw 32-byte public key. */
export interface SigningKey {
  readonly publicKey: Uint8Array;
  sign(bytes: Uint8Array): Uint8Array;
}
export function newSigningKey(): { key: SigningKey; pem: string };   // PKCS #8 PEM
export function signingKeyFromPem(pem: string): SigningKey;          // throws KeyFormatError
export class KeyFormatError extends Error { readonly problem: "not-a-key" | "not-ed25519" }
```

- **The raw public key** comes from the JWK's `x`, base64url-decoded, in
  one place.
- **The callers:**
  - `a4 plugin keygen` writes `newSigningKey().pem` with mode `0600` and
    flag `wx`, as now;
  - `pack` maps `KeyFormatError` to its two usage errors, worded as now;
  - the example build reads the PEM, or makes and writes one;
  - `testKey()` returns `newSigningKey().key`, so `TestKey` becomes an alias
    of `SigningKey`.
- **The module is Node-only,** like `lib/persist/folder/fs-node.ts`. It's
  named `-node` so nothing in the app imports it. The dependency rules gain
  it in `cli-through-index`'s list, and `pnpm check:bundle` proves the first
  load doesn't reach it.
- **Alternative:** WebCrypto Ed25519, shared with the browser's verifier.
  Rejected: the CLI's keys are PEM files, which `node:crypto` reads directly,
  and the browser only verifies.

### 3. `lib/persist/autosave/poll.ts`: one poll loop

```ts
export class PollLoop {
  constructor(options: {
    scheduler: Scheduler;
    intervalMs: number;
    isVisible: () => boolean;
    /** One pass. */
    poll: () => Promise<void>;
    /** Whether there's anything to poll; while false, no timer is set. Defaults to always. */
    active?: () => boolean;
  });
  /** Set the next timer, unless one is set, the loop stopped, or there's nothing to poll. */
  start(): void;
  /** One pass now, skipped while hidden, stopped, or already polling. */
  tick(): Promise<void>;
  stop(): void;
}
```

- **After each timer's pass** it calls `start()` again, as both loops do
  now.
- **`LibraryPoller`** keeps its comparison of names, sizes, and times, and
  its `tick()` for tests. It runs on a loop of 2,000 ms.
- **`FileWatcher`** keeps its watched map and per-file comparison. Its loop
  runs every 1,000 ms, `active` is "a file is watched", and `watch()` calls
  `start()`.
- **`Scheduler` already lives in `autosave/session.ts`,** which both layers
  import, so the loop sits beside it.

### 4. Copy: `share-copy.ts` and a new `served-copy.ts`

- **`share-copy.ts` gains:**
  - `SHARED_PILL` ("Shared · not saved");
  - `sharedShownOn(specs)`: "Shown on A4 and A5, as the sender saw them.";
  - `sharedSealFor(name)`: the "“Brief”: " prefix for a pair's seal line;
  - `SHARE_LINK_UNREADABLE`.
- **`components/served-copy.ts` holds:**
  - the switch's labels and titles;
  - the Connect form's hint (its text, with the command apart, to render as
    code), its field labels, and its buttons;
  - `badConnection(port)` and `BAD_CONNECT_LINK`;
  - a private `cause(reason, address, message)`: the first sentence for
    each reason but a refused token;
  - `unavailableNotice(...)`: the cause, "Showing this browser’s library.",
    and what to do from the switch, as today;
  - `connectFailed(...)`: the cause, and what to do from the form.

  A refused token is worded where it's said. The notice explains a restart
  with `--new-token`, as today. The form reads "a4 serve at 127.0.0.1:4320
  refused this token. Check it: it's the end of the link a4 serve printed,
  after the last dot."
- **`notices.ts`** calls `unavailableNotice`, so `notices.test.ts` passes
  unchanged.
- **Like the other copy modules,** it imports `lib/` by relative path, so a
  `node --test` file can check every sentence.

### 5. Connecting by hand checks first

- **The workspace.**
  - `Workspace.connectServed(connection, from: "link" | "form")` keeps the
    link's path.
  - For `"form"`, it first reaches the server once (`GetLibrary`, through
    the same `#reach` a switch uses). If that throws `StoreUnavailableError`,
    it returns `{ connected: false, reason, message }`, and writes nothing,
    publishes nothing, and notifies nothing.
  - Otherwise it continues as the link does: it remembers, publishes, and
    switches.
  - The result type is `Result<{ connected: true } | { connected: false;
    reason: UnavailableReason | null; message: string }>`.
- **The UI.**
  - `LibraryActions.connect` returns `connectFailed(…)` for a failed check,
    or the malformed-address error. The form keeps showing it inline.
  - The form keeps its fields filled, as it does now for an error.
  - The form closes only on `{ connected: true }`.
- **A server that stops between the check and the switch** is the switch's
  usual case. It notifies, and shows this browser's library. The connection
  stays remembered, because the server did answer.
- **Alternative:** one probe that switches and rolls back the setting on
  failure. Rejected: the snapshot's `served` would flicker, showing the
  switch for a moment before taking it back.

### 6. A shared page has its own slot type

```ts
// lib/workspace/types.ts: every variant gains a kind
export type SlotSnapshot =
  | (SlotBase & { kind: "empty"; ref: null; name: null })
  | (SlotBase & { kind: "library"; ref: LibraryRef; name: PageName })
  | (SlotBase & { kind: "file"; ref: FileRef; name: null });

// components/workbench/shared-slots.ts (StageSlot is re-exported by stage.ts)
interface SharedSlot { kind: "shared"; ref: null; name: null; label: string; text: string; status: "saved"; readOnly: true }
export type StageSlot = SlotSnapshot | SharedSlot;
export function sharedSlots(a: SharedPageView, b: SharedPageView | undefined): Record<Slot, StageSlot>;
```

- **The workspace never holds a shared page,** so the variant lives with
  the stage, in `shared-slots.ts`. `useSharedView` builds its slots there,
  and so does the test, so `stage.ts` and `useSharedView.ts` don't import
  each other. `Stage.slots`, `SharedView.slots`, and the props of
  `SheetStage`, `DocTitle`, and the page menu become `StageSlot`.
- **The checks:**
  - `SheetStage` checks `kind === "shared"` for the caption, and
    `kind === "empty"` to hide the sheet;
  - `DocTitle` checks `kind === "shared"`;
  - nothing else reads the null-ref-with-label combination.
- **`SlotController` and `useWorkspace`'s first snapshot** set `kind` with
  `ref`. A `stage.test.ts` case checks a shared pair's slots are `shared`,
  and a single shared page's B is `empty`.
- **Alternative:** a `shared: true` flag on `SlotSnapshot`. Rejected: it
  puts a stage concept into the workspace's type, and a flag beside a null
  `ref` still needs the reader to combine two fields.

### 7. Closing the review

`docs/tech-debt-review.md` moves the last items into "Taken up by
`finish-tech-debt-review`", in the style of the earlier rounds. It removes
the "Left for a later round" heading, and the status line says the review's
items are all taken up.

## Risks / Trade-offs

- **[Risk] The IndexedDB rewrite could change a stored value's shape.** →
  The helper stores and reads exactly what each store passes. The plugin
  store's contract runs in Node and in the browser, and the handle store
  gains the same browser contract. A folder picked before the change must
  still read back after it, and installed plugins must still load. Tasks
  1.1 and 9.2 check both on localhost, with the origin-private file
  system's root as the handle.
- **[Trade-off] The Connect form reaches the server twice on success,** once
  to check and once to switch. → Both are local `GetLibrary` calls of a few
  bytes, and only when the author connects by hand.
- **[Risk] The poll loops' timing could change.** → `PollLoop` keeps both
  intervals and the order "poll, then schedule". The existing
  `watch.test.ts` and served-library tests run on the fake scheduler, and
  must pass unchanged.
- **[Trade-off] `TestKey` becomes `SigningKey`.** → Tests keep the
  `testKey()` name, so only the type changes.

## Migration Plan

- **No stored data changes.** The databases, keys, and settings are read as
  before.
- **The deploy is a normal Worker deploy.** Nothing crosses tabs differently.
- **Rollback is a revert.**
