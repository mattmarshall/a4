# Design: harden-served-protocol

## Context

See proposal.md for why, and the spec delta for behavior. The code this
builds on:

| Piece | Where | What changes |
| --- | --- | --- |
| The service | `proto/a4/v1/store.proto`: `PageStoreService` (10 methods), `StoreFailure` (flat: `page`, `expected`, `actual`, `reason`) | `GetLibrary`, `LibraryInfo`, a typed failure detail; the flat detail fields deprecated |
| The server's handler | `lib/persist/store/serve.ts`: `HANDLERS: Record<string, Handler>`, requests typed by hand, `failure()` casts the error to a bag | Rebuilt on one typed table |
| The client | `lib/persist/store/remote.ts`: imports 20 schemas, `#call("ReadPage", …Schema, …Schema, …)`, its own `errorOf` | Derived from the service; the error mapping shared |
| The typed pattern | `lib/models/client.ts`: `MethodName` and per-method `In`/`Out` types derived from `SheetModelService`'s `GenService` | The same derivation for `PageStoreService` |
| The library's keys | `lib/workspace/library-target.ts`: journal `a4:served:<address>:`, channel `a4-pages:<address>`, open pages `SETTINGS.servedOpenA/B` (keyed by nothing) | Keyed by the library's id |
| Reaching the server | `workspace.ts` `#reach`: a served store is reached by listing it | By `GetLibrary` |
| The unreachable notice | `{kind: "served-unreachable", address, error}`, worded "Run a4 serve …" whatever happened | Carries the reason |
| Token file | `cli/serve.ts`: `.a4-serve-token`, rewritten by `--new-token` | A separate `.a4-library` beside it |

## Goals / Non-Goals

**Goals**
- **A method the proto adds doesn't compile until the server handles it.**
- **Each conversion is written once, beside its inverse,** and tested by
  round-tripping it.
- **Nothing a served library keeps in the browser can reach another
  library,** whatever port it's served on.
- **The protocol stays additive:** `pnpm proto:check` (buf's FILE rules)
  passes against main.

**Non-Goals**
- **Adopting Connect or another RPC library.** The transport stays the
  plain POST from add-served-library.
- **Serving several protocol versions** from one server.

## Decisions

### 1. One wire module derives the method types from the generated service

`lib/persist/store/wire.ts` does for `PageStoreService` what
`lib/models/client.ts` does for `SheetModelService`:

```ts
type Methods = typeof PageStoreService extends GenService<infer T> ? T : never;
export type StoreMethod = keyof Methods & string;
type In<K> = MessageShape<Methods[K]["input"]>;
type Out<K> = MessageShape<Methods[K]["output"]>;
type OutInit<K> = MessageInitShape<Methods[K]["output"]>;

/** The server: one handler per method; omitting one is a type error. */
export type StoreHandlers = { [K in StoreMethod]: (request: In<K>) => Promise<OutInit<K>> };
```

- **The server's side.** `serve.ts` builds a `StoreHandlers` over a
  `PageStore` and the library's identity. `handleStoreCall` looks the method
  up by its wire name and decodes with that method's own schema.
- **One codec, typed by method.** `encodeRequest`, `decodeRequest`,
  `encodeResponse`, and `decodeResponse` live in `wire.ts`.
  - TypeScript widens a generic method's schema to the union of every
    method's, so these four assert the type that the same method's
    descriptor produces.
  - They're the only casts on the wire, and both sides use them.
- **The client's side.** `remote.ts` gets a typed `call(method, request)`
  from the same descriptor. It names each method once, with its request
  checked against the method's input type, and imports no schemas.
- **A type test proves the server's guarantee.** A test file holds a
  handler table with one method left out, under `// @ts-expect-error`, so
  `pnpm typecheck` fails if leaving a method out ever compiles.
- **Conversions live in `wire.ts` as pairs,** each beside its inverse:
  summary, page, write result, trash entry. A test round-trips each one.
  - **The server's direction** writes the store's values.
  - **The client's direction** checks what it reads: a name or revision
    that doesn't parse is StoreUnavailableError ("bad answer"), as today.

**Alternative: generate both sides with Connect (`@connectrpc/connect`).**
add-served-library chose the same wire shape without the dependency. The
typed table gives the compile-time check without adding one.

### 2. Failures: a typed detail beside the deprecated flat fields

```proto
enum UnreadableReason { UNREADABLE_REASON_UNSPECIFIED = 0; UNREADABLE_REASON_TOO_LARGE = 1; UNREADABLE_REASON_NOT_UTF8 = 2; }
message ConflictDetail { string expected = 1; optional string actual = 2; }
message UnreadableDetail { UnreadableReason reason = 1; }
message StoreFailure {
  StoreErrorCode code = 1; string message = 2; string page = 3;
  string expected = 4 [deprecated = true];
  optional string actual = 5 [deprecated = true];
  string reason = 6 [deprecated = true];
  oneof detail { ConflictDetail conflict = 7; UnreadableDetail unreadable = 8; }
}
```

- **One table in `wire.ts`** maps each `PageStoreErrorCode` to:
  - its `StoreErrorCode` and HTTP status, as `serve.ts`'s `ERRORS` does
    today;
  - a function from the typed error class to the failure;
  - a function from the failure back to the error.
- **No more casting to a bag.** Each error class is matched by its class
  (`PageConflictError`, `FileUnreadableError`, …), so each detail is read
  from typed fields.
- **The server still fills the deprecated fields,** so a tab loaded before
  the update still reads a conflict or an unreadable file correctly. The
  client reads only the detail. The deprecated fields go in the next
  protocol version.

**Alternative: change `reason` to the enum in place.** That changes a field's
type, which buf's FILE rules reject, and an old tab would misread it.

### 3. The library's id: a file beside the token

- **What it is:** 16 random bytes, base64url, 22 characters, in
  `<folder>/.a4-library`.
- **How it's made:** with an exclusive create the first time the folder is
  served. It's never rewritten, and `--new-token` doesn't touch it.
- **A file that doesn't hold an id** (edited by hand) makes `a4 serve` exit 2,
  saying to delete the file to make a new id. Replacing it silently would
  orphan the library's drafts.
- **It isn't secret.** It's an id, not a key, so its mode is 0644.

**Alternatives:**
- **In the token file.** `--new-token` rewrites that file, and its format
  would change under running checkouts.
- **Derived from the folder's path.** Moving the folder would orphan its
  drafts and open pages.
- **A copied folder shares its id** (see Risks).

### 4. `GetLibrary` and one protocol version

- **The call:**
  `rpc GetLibrary(GetLibraryRequest) returns (GetLibraryResponse)`, with
  `LibraryInfo { string id = 1; uint32 protocol = 2; }`.
- **The version:** `STORE_PROTOCOL = 1`, in `wire.ts`, which both sides
  import.
- **`RemotePageStore.library()`:** it asks `GetLibrary` and checks the
  answer:
  - **404 with an empty body** (an `a4 serve` that doesn't know the method)
    is StoreUnavailableError with reason `older-server`;
  - **a lower `protocol`** is also `older-server`;
  - **a higher `protocol`** is `newer-server`;
  - **an id that isn't 22 base64url characters** is `bad-answer`.

  It returns the id.

**Alternative: a protocol header on every request.** Every call would pay
for a check that only needs to happen when the app reaches a server, which
is where `GetLibrary` runs.

### 5. Reaching a served library means learning its id

- **What the workspace's option returns:** `openServed` returns a
  `ServedStore`, a `PageStore` with `library(): Promise<string>`.
  `RemotePageStore` implements it, and the workspace tests' stand-in does
  too.
- **Reaching:** `#reach` asks `library()` instead of listing. A refusal
  changes nothing, as now.
- **The target carries the id:**
  `LibraryTarget` becomes
  `{kind: "served", connection, library: LibraryId}`.
  - `sameTarget` compares the library id.
  - `journalPrefix` is `a4:served:<id>:`.
  - `channelName` is `a4-pages:served:<id>`.
  - `openSettings` gives `served:<id>:open:a` and `…:b`. These are settings
    made per id, since `defineSetting` is just a typed object.
- **What `connectServed` no longer does:** forget open pages when the
  address changes. Pages are kept per library now.
- **What Disconnect still does:** forget the connection.
- **What Disconnect stops doing:** wiping open pages, which belong to the
  library, not to the connection.

### 6. Adopting what was kept by address, once

When a library is reached at address A, before it's shown:

1. **Drafts.** If the journal holds drafts under `a4:served:A:`, recover
   them into this library: a journal with the old prefix, through
   `recoverDrafts` with `includeOwnTab` and the live set (decision 5 of
   add-served-library). Its revision check applies a draft only over the
   page it was made from, and saves it as a copy otherwise. Recovered and
   discarded drafts leave the journal, so this runs once.
2. **Open pages.** If `served:open:a` or `served:open:b` is set and the
   library has no open pages of its own yet, copy them to its id's keys.
   Then clear the old keys in either case.

The recoveries join the library's own in the "recovered" notice.

### 7. A reason on StoreUnavailableError, worded in notices.ts

- **The error:** `StoreUnavailableError` gains
  `reason: "not-running" | "refused" | "older-server" | "newer-server" | "bad-answer"`.
  - **not-running:** a fetch that fails.
  - **refused:** a 401 or 403.
  - **older-server and newer-server:** decision 4.
  - **bad-answer:** an answer that can't be decoded, or a name or revision
    that doesn't parse.
- **The notice:** `served-unreachable` takes the reason from the error.
  `notices.ts` words each case, with what to do (the spec's list).
- **Other stores:** the reason is `null` when the browser's own store or a
  folder throws StoreUnavailableError. Only the served-unreachable notice
  reads it.

## Risks / Trade-offs

- **[Risk] A copied library folder shares its id.**
  - Two copies served on different ports would share drafts and open pages.
  - Revision checks still keep a draft from overwriting the wrong page.
  - The README says to delete `.a4-library` in a copy, to make it a library
    of its own.
- **[Risk] An `a4 serve` left running from an older checkout stops working**
  once a4.marsh.build deploys this. That's the intent: the notice says to
  update the checkout and restart it, and nothing is written meanwhile.
- **[Risk] A tab loaded before the deploy talks to an updated server.**
  - It doesn't call `GetLibrary`, and keeps drafts by address.
  - It still works, because the server answers the old methods unchanged
    and fills the deprecated failure fields.
  - After a reload, the adoption step moves its drafts to the library's id.
- **[Trade-off] Exact version matching.** Any protocol change makes app and
  server update together. They ship from one repository, so that's the
  simplest correct rule. Ranges can come with a version 2 that needs them.

## Migration Plan

- **Wire compatibility:** the proto changes are additive (a new method,
  new messages, new fields in a oneof, deprecations), and `pnpm proto:check`
  enforces that.
- **What's kept by address** is adopted on first reach (decision 6). Nothing
  is deleted before it's recovered or copied.
- **Rollback:** reverting leaves `.a4-library` files, which are harmless, and
  id-keyed drafts the old code doesn't read. Those wait in local storage,
  and are recovered again on the next update.
