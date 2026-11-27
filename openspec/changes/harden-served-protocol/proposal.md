# Proposal

## Why

The served library's protocol has two weaknesses, the first two items left
in `docs/tech-debt-review.md`.

**The protocol is written out by hand on both sides.**
- `lib/persist/store/serve.ts` keeps its handlers in a `Record<string, …>`,
  with each request typed by hand and decoded through `as never`.
- `lib/persist/store/remote.ts` imports twenty schemas and repeats each
  method's name.
- The conversions between the store's types and the wire's are inverse pairs
  that live in different files.
- A store error crosses as a flat `StoreFailure`. Its `reason` is a free
  string, and the server builds it by casting the error to a bag of optional
  fields.

So a new method compiles on both sides without being handled, and the two
sides can drift apart without a test noticing.

**A served library has no identity.**
- The app keeps a served library's unsaved edits under its address
  (`a4:served:127.0.0.1:4320:`), and remembers its open pages without any key
  at all.
- So another folder served on the same port inherits the first folder's
  drafts and open pages.
- Nothing says which protocol a server speaks. An `a4 serve` from an older
  checkout fails in whatever way its missing methods happen to fail.
- A refused token reads the same as a stopped server: "isn't running".

## What Changes

- **One typed protocol, shared by both sides.**
  - A new module, `lib/persist/store/wire.ts`, derives the method names and
    each method's request and response types from the generated
    `PageStoreService`.
  - The server's handlers are a table keyed by every method name, so adding
    a method to the proto doesn't compile until the server handles it.
  - The client is derived from the same descriptor, so `remote.ts` names
    each method once and imports no schemas.
  - Each conversion between a store type and its wire message is written
    once, both ways, beside its inverse.
- **Typed failures.**
  - `StoreFailure` gains a typed detail: a conflict's expected and stored
    revisions, or why a file can't be read (an enum, not a string).
  - The error mapping is one table, used by both sides.
  - The fields this replaces stay on the wire, deprecated, for tabs loaded
    before the update.
- **A library identity.** `a4 serve` gives each library folder an id, kept in
  `<folder>/.a4-library`.
  - It's made the first time the folder is served, and kept across restarts
    and `--new-token`.
  - A new method, `GetLibrary`, returns the id and the protocol version the
    server speaks.
- **The app knows which library it's showing.**
  - Connecting, starting up on, or switching to the served library first
    asks `GetLibrary`.
  - Drafts, tab messages, and remembered open pages are kept by the
    library's id, not its address. Another folder served on the same port is
    a different library.
  - Drafts and open pages already kept by address are adopted by the first
    library reached at that address. A draft's revision check keeps it from
    overwriting a page it wasn't made from: at worst it's saved as a copy.
- **Versions must match.**
  - A server that doesn't know `GetLibrary`, from an older checkout, is
    refused like one that's down.
  - A4 says that `a4 serve` at that address is older than this A4, and how
    to update it, and shows this browser's library. Nothing is read or
    written.
  - A server newer than the app is refused the same way, asking the author
    to reload A4.
- **Each refusal says what happened.** The served library's unreachable
  notice names the cause and the fix:
  - **not running:** start `a4 serve`;
  - **token refused:** open the link it printed again;
  - **older server:** update and restart it;
  - **newer server:** reload A4;
  - **an answer A4 can't read.**

### Out of scope

- Any change to what a store operation does, or to the security model:
  loopback only, the `Host` check, the origin allowlist, and the token.
- Showing a server's error in the Connect form itself. That's its own item
  in the tech debt review.
- Compatibility ranges. The app and server speak one protocol version, and
  any other version is refused.
- Removing the deprecated `StoreFailure` fields. That waits for the next
  protocol version.
- The other "left for a later round" items: the pen UI, the plugin
  lifecycle, and the smaller copies.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `served-library`:
  - The protocol gains `GetLibrary`, a protocol version, and typed failure
    details.
  - A library has an id that outlives restarts and new tokens.
  - Drafts, tab messages, and open pages are kept per library, by that id.
  - A server from another version is refused, with what to do.
  - The unreachable notice says whether the server is down, refused the
    token, or is the wrong version.

## Impact

- **Protos:** `proto/a4/v1/store.proto` adds `GetLibrary`, `LibraryInfo`, and
  `StoreFailure`'s typed detail, an `UnreadableReason` enum, and deprecates
  the flat fields. All of it is additive: `pnpm proto:check` (buf's FILE
  rules) must still pass.
- **Store:**
  - `lib/persist/store/wire.ts` is new: the method table types, the
    conversions, and the error mapping.
  - `serve.ts` and `remote.ts` are rebuilt on it.
  - `StoreUnavailableError` carries a reason, such as not running, refused,
    older server, newer server, or a bad answer.
  - `RemotePageStore` gains `library()`.
- **CLI:** `cli/serve.ts` makes and keeps `.a4-library` beside
  `.a4-serve-token`, and answers `GetLibrary`.
- **Workspace:**
  - `lib/workspace/library-target.ts` keys the served library by id.
  - `workspace.ts` asks for the identity when it reaches the server, and
    adopts address-keyed drafts and open pages once.
  - Settings gain the id the remembered open pages belong to.
- **UI:** `components/workspace/notices.ts` words the unreachable notice for
  each reason.
- **Docs:**
  - The README's "Served library" section covers `.a4-library`, versions,
    and what each refusal means.
  - The two items move out of `docs/tech-debt-review.md`'s "Left for a
    later round".
