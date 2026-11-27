# Tasks

## 1. The protocol

- [x] 1.1 Extend `proto/a4/v1/store.proto` (design decisions 2 and 4):
  - add `GetLibrary`, with its request, `GetLibraryResponse`, and `LibraryInfo { id, protocol }`;
  - add `StoreFailure`'s `oneof detail` (`ConflictDetail`, `UnreadableDetail`) and the `UnreadableReason` enum;
  - mark `expected`, `actual`, and `reason` deprecated.

  Run `pnpm proto`, and verify `pnpm proto:check` passes, including buf's breaking check against main.
- [x] 1.2 Add `lib/persist/store/wire.ts` (design decisions 1 and 2):
  - `StoreMethod`, per-method request and response types, and `StoreHandlers`, derived from `PageStoreService`;
  - `STORE_PROTOCOL = 1`;
  - each conversion pair (summary, page, write result, trash entry);
  - the error table: code, status, error to failure, and failure to error.

  Add `wire.test.ts`, and verify:
  - each conversion round-trips;
  - every store error class crosses as itself, with its detail (a conflict's revisions, unreadable's reason);
  - the server's failure still fills the deprecated fields, for tabs loaded before the update.

  Also add a type test where a handler table missing one method fails `pnpm typecheck` (`// @ts-expect-error`).
- [x] 1.3 Rebuild `lib/persist/store/serve.ts` on `StoreHandlers`:
  - no `Record<string, …>`, no `as never`;
  - `GetLibrary` answers the library's id and `STORE_PROTOCOL`;
  - failures carry the typed detail and the deprecated fields.

  Verify `pageStoreContract` over the in-process handler passes unchanged, and an unknown method still gets 404.

## 2. The client

- [x] 2.1 Give `StoreUnavailableError` a reason: `not-running`, `refused`, `older-server`, `newer-server`, `bad-answer`, or `null` for the other stores (design decision 7). Verify the store type tests and every existing test still pass.
- [x] 2.2 Rebuild `lib/persist/store/remote.ts` on `wire.ts`:
  - a typed `call(method, request)` from the service descriptor, with no schema imports and each method named once;
  - errors read from the typed detail;
  - each unavailable case carries its reason.

  Add `library()` (design decision 4). Verify, with an in-process fake server:
  - `pageStoreContract` passes;
  - a 404 from `GetLibrary` is `older-server`;
  - a lower protocol is `older-server`, and a higher one `newer-server`;
  - a 401 or 403 is `refused`;
  - a malformed id is `bad-answer`;
  - a failed fetch is `not-running`.

## 3. `a4 serve`

- [x] 3.1 Keep the library's id in `<folder>/.a4-library` (design decision 3):
  - made with an exclusive create on first serve, mode 0644, and never rewritten;
  - `--new-token` doesn't touch it;
  - a file that doesn't hold an id exits 2, saying to delete it.

  Answer `GetLibrary` with it. In `cli/serve.test.ts`, verify:
  - the id is the same after a restart and after `--new-token`;
  - two folders get different ids;
  - a damaged file exits 2;
  - `pageStoreContract` still passes over HTTP;
  - `RemotePageStore.library()` returns the folder's id from a running server.

## 4. The workspace

- [x] 4.1 Key the served library by its id (design decision 5):
  - `openServed` returns a `ServedStore` (a `PageStore` with `library()`);
  - `#reach` asks `library()` instead of listing;
  - `LibraryTarget` carries the id;
  - `journalPrefix`, `channelName`, and `openSettings` use it;
  - `connectServed` no longer clears open pages, and Disconnect forgets only the connection.

  Update `library-target.test.ts`. Give `served.test.ts`'s stand-in an id, and verify:
  - every existing served test passes;
  - a draft made on one library isn't recovered into another library at the same address, and is recovered into its own when that one is back;
  - open pages come back per library;
  - an older or newer server leaves this browser's library shown, with the notice and its reason, and receives no page operation.
- [x] 4.2 Adopt what was kept by address, once (design decision 6), before the library is shown. With journal entries and settings written under the old keys, verify:
  - an unchanged page gets its draft applied;
  - a changed page keeps its text, and the draft is saved as a copy;
  - remembered open pages move to the library's id;
  - nothing is left under the address afterwards, and a second connect adopts nothing.

## 5. Notices and docs

- [x] 5.1 Word the served-unreachable notice for each reason in `components/workspace/notices.ts`, each with what to do (the spec's list). Extend `notices.test.ts` with one sentence per reason, and verify the not-running sentence is the one shipped today.
- [x] 5.2 Update the README's "Served library" section:
  - `.a4-library`: what it is, that it survives `--new-token`, and to delete it in a copied folder;
  - what each refusal means and what to do;
  - that app and server must speak the same version.

  Move the two items out of `docs/tech-debt-review.md`'s "Left for a later round", saying where they went. Verify `pnpm lint` passes.

## 6. End-to-end checks

- [x] 6.1 Verify in the built-in browser, against the dev server and a real `a4 serve` with `--origin http://localhost:5173`:
  - connect, type on "Brief", and see it saved;
  - stop the server and serve a different folder on the same port, connect, and see no draft or open page carried over;
  - serve the first folder again, and see its "Brief" open again;
  - restart with `--new-token`, switch, and read the "refused" notice, then open the new link and see the same library;
  - put this browser back on its own library, disconnected.
- [x] 6.2 Run `pnpm check`, and verify it passes, the bundle check included.

## Workflow follow-up

- Commit, push, and check the CI and deploy runs.
- Archive the change and sync its specs.
