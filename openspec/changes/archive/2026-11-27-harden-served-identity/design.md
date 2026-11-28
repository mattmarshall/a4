# Design: harden-served-identity

## Context

See proposal.md for why, and the spec delta for behavior. The code this
builds on:

| Piece | Where | What changes |
| --- | --- | --- |
| The poller | `lib/workspace/library-poller.ts`: every 2,000 ms on `PollLoop`, it lists the pages and reports changes. A listing that fails is skipped | Asks `GetLibrary` first, and reports another library or a refusal |
| Showing a library | `Workspace.#switchTo(choice, { reached, quiet })` returns null once `choice` is shown, or the `StoreUnavailableError`. It does nothing when `isShown(target, choice)`, which compares connections only | Gains `again`, which shows the same connection afresh |
| Notices | `WorkspaceNotice` has `served-unreachable` (address, reason, error). `describeNotice(notice)` in `components/workspace/notices.ts` words it through `unavailableNotice` | Adds `served-replaced`, and the page's origin is passed in |
| Refusal sentences | `remote.ts` and `wire.ts` give each `StoreUnavailableError` a sentence. `served-copy.ts`'s private `cause` writes the older, newer, and bad-answer causes again, and both refused sentences are written there | The error's sentence is the cause. The copy adds what to do |
| Library ids | `wire.ts`: `type LibraryId = string`, `isLibraryId`, `libraryFrom`. Used by `remote.ts`, `serve.ts`, `cli/serve.ts`, `library-target.ts`, and `settings.ts` (`servedOpenSetting(library: string, …)`) | Branded |
| The origin | `lib/platform/origin.ts` exports `APP_ORIGIN`, which `a4 serve` always allows | The notice and the form compare the page's origin with it |

## Goals / Non-Goals

**Goals**
- **A4 never shows one library under another's id.** Every poll pass
  confirms the id, so a different library is noticed within one pass (about
  2 seconds), well inside the spec's 5.
- **A server A4 can no longer use is left on its own terms.** A refused
  token or another version mid-session ends as a switch to it would: this
  browser's library is shown, with the reason.
- **One sentence per cause, and one place per remedy.**
- **An id can't be confused with an address at compile time.**

**Non-Goals**
- **No protocol or proto change.** The extra `GetLibrary` per pass is a
  local call of a few bytes.
- **Leaving a stopped server shown.** A pass that can't reach the server
  is skipped, so a restart doesn't throw the author out.
- **UI tests.** The decisions are in the workspace and the copy, tested
  under `node --test`.

## Decisions

### 1. Each poll pass asks `GetLibrary` first

`LibraryPoller` takes the shown library's id and a `ServedStore`, not a
`PageStore`. Each pass:
1. Calls `store.library()`:
   - **A `StoreUnavailableError` whose reason is `not-running` or
     `bad-answer`, or no reason:** skip the pass, as a failed listing does
     now. The server may be restarting, or cut off an answer.
   - **Reason `refused`, `older-server`, or `newer-server`:** report
     `{ kind: "refused", error }`, and stop.
   - **An id other than the shown one:** report `{ kind: "replaced" }`, and
     stop.
2. Lists the pages and reports changes, as now.

The report becomes a union: `{ kind: "changed", changed, listChanged } |
{ kind: "replaced" } | { kind: "refused", error }`.

- **Why every pass, not only after a failed one:** a server restarted
  between two passes, under 2 seconds apart, never fails a pass. Comparing
  the id each time is the only way not to miss it.
- **Alternative:** add `LibraryInfo` to `ListPagesResponse`, for one
  request. Rejected: it changes the protocol for a saving of one local call.
- Either report stops the poller: the library it watched is gone.

### 2. Changes confirm the library first

A poll alone leaves a gap of up to 2 seconds. A save retried after the
server stopped, or one typed just after another folder is served, would
land in that folder before the poll notices. So the workspace wraps a
served library's store in a `ConfirmedStore` (`lib/workspace/confirmed-store.ts`)
that knows the id it was reached as:
- **Before each change** (write, create, rename, trash, restore, purge), it
  asks `GetLibrary`.
- **Another id:** the change fails as unavailable ("a4 serve at … now serves
  another library."). A save's text stays in the journal, under the first
  library's id.
- **Refused:** the change fails with the refusal, and no page operation
  reaches the server. That's also what closing the slots does once the
  poller reports a refusal: their last saves fail, and their drafts are
  kept.
- **Reads aren't checked.** Nothing is written meanwhile, and the poller
  notices within a pass.

### 3. The workspace shows the new library, or this browser's

`#servedReport` handles the union:
- **`changed`:** as now.
- **`replaced`:** `#switchTo(choice, { from: target, notice })`.
  - `from` is the library the report was about. The switch runs only while
    it's still the one shown, and skips the `isShown` check. So the switch
    reaches the server again, learns the new id, and saves and closes both
    slots. An edit that couldn't be saved stays in the first library's
    journal, under its id.
  - It then shows the new library with its own remembered pages. A library
    reached again as the same id is left as it is.
  - On success it notifies `notice`, `{ kind: "served-replaced", address }`.
    If the second reach fails, the switch's own unreachable path applies.
- **`refused`:** `#switchTo(BROWSER, { from: target, notice })`, with the
  `served-unreachable` notice a refused switch gives.
  - The connection stays remembered, so the switch is still offered.
  - The poller has stopped, and the closing slots' saves are refused by
    `ConfirmedStore`, so the server gets no further page operation.

### 4. The cause is the error's sentence; the copy adds what to do

- **`served-copy.ts` loses `cause`.** `unavailableNotice` and
  `connectFailed` start with the error's own message for every reason, then
  add the remedy for their context.
- **The refused-token notice** reads "a4 serve at 127.0.0.1:4320 refused
  this browser's token. It was probably restarted with --new-token. Showing
  this browser's library. Open the link it printed to connect again."
  - That replaces today's "…token: it was probably…".
  - The bad-answer notice starts with whichever unreadable answer the error
    names.
  - `notices.test.ts` is updated to the new wording, which keeps the same
    facts and remedies.
- **The origin hint.**
  - `unavailableNotice` and `connectFailed` take the page's origin.
  - For `not-running`, when that origin isn't `APP_ORIGIN`, they add "If
    it's running, it may not allow this page.", and the command they give
    becomes `a4 serve <folder> --origin http://localhost:5173`.
  - `describeNotice(notice, pageOrigin)` passes it on. `useWorkspace`
    passes `window.location.origin`, to both it and `connectFailed`.
  - Neither takes the address any more: each error's sentence names it.
  - The tests pass origins explicitly.
- **`served-replaced` reads** "a4 serve at 127.0.0.1:4320 now serves
  another library, so its pages are shown. Edits to the other one stay with
  it, for when it's served again."
- **Alternative:** have `a4 serve` answer refused origins with CORS headers
  and a typed failure, so A4 could tell for sure. Rejected: it means
  answering the preflight of any site that asks, which widens what reaches
  the server, for a case only a developer meets.

### 5. `LibraryId` is a brand

```ts
declare const libraryIdBrand: unique symbol;
export type LibraryId = string & { readonly [libraryIdBrand]: true };
export function isLibraryId(text: string): text is LibraryId;
```

- **`isLibraryId` is the only way in.** It's a type guard, so it needs no
  cast. `libraryFrom` returns what it checked, and `cli/serve.ts` already
  checks the id file with it.
- **The id-keyed helpers take `LibraryId`:** `servedOpenSetting(library:
  LibraryId, …)`, and through `LibraryTarget`, `journalPrefix` and
  `channelName`. The legacy-by-address helpers keep taking an address.
- **Tests build ids with a small `libraryIdOf(text)`** in
  `lib/persist/store/testing/`. It throws when `isLibraryId` refuses, so
  no test casts.
- **`scripts/cast-report.ts`** adds `LibraryId` to `BRANDS`. `wire.ts` is
  allowed no cast, because none is needed.
- **A compile-time check:** `served.test.ts` holds a function it never
  calls, with `// @ts-expect-error` on `servedOpenSetting("127.0.0.1:4320",
  "a")`.

## Risks / Trade-offs

- **[Trade-off] One more request per poll pass, and per change.** → It's a
  loopback `GetLibrary` of about 30 bytes each way: every 2 seconds while a
  served library is shown in a visible tab, and before each save, which
  autosave sends at most every 600 ms.
- **[Risk] A copy shown by mistake when the author meant the original.** →
  It's what the author served at that address. The notice says so, and the
  original's edits stay under its id until it's served again.
- **[Risk] A server that's slow to answer `GetLibrary` delays the listing.**
  → `PollLoop` never overlaps passes, so a slow pass delays the next one
  and nothing piles up.
- **[Trade-off] Two notices change wording.** → Same facts and remedies.
  The README quotes neither.

## Migration Plan

- **No stored data changes.** Ids, drafts, and settings are read as before.
- **The deploy is a normal Worker deploy.** An older `a4 serve` already
  answers `GetLibrary`, or is refused as older.
- **Rollback is a revert.**
