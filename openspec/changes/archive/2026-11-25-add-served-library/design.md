# Design: add-served-library

## Context

See proposal.md for why, and the spec delta for behavior. The code this
builds on:

| Piece | Where | What changes |
| --- | --- | --- |
| The contract | `lib/persist/store/types.ts` (`PageStore` over `PageFiles`, typed `StoreError`s), `lib/persist/store/testing/contract.ts` (`pageStoreContract`, run in `store.test.ts`) | Two more runs: the served folder, and the store over HTTP |
| The OPFS store | `lib/persist/store/opfs.ts`. `OpfsPageStore.open(root, { locks, clock })` makes `a4/pages` and `a4/trash` under `root`. It uses `getDirectoryHandle`, `getFileHandle`, `entries`, `removeEntry`, `createWritable`, and `getFile` | An option to keep `pages/` and `trash/` at the root |
| Locks | `lib/platform/locks.ts` (`Locks.request(name, fn)`; Web Locks in the browser) | An in-process lock for the server |
| Startup | `lib/workspace/workspace.ts` `#start`. It opens the store, makes a `Journal` (prefix `a4:`), recovers drafts, builds a `LibraryIndex` over the `a4-pages` channel, and reopens `SETTINGS.openA`/`openB` | Factored into `#showLibrary(source)`, which runs again to switch |
| Other tabs' saves | `LibraryIndex` hears `pageSaved` and `pagesChanged` events, and the slot adopts a page with no unsaved edits | A poller raises the same events for changes on disk |
| Fragments | `components/workbench/useSharedView.ts` reads `#s1.` links | It also reads `#serve=` links |
| The CLI | `cli/a4.ts`, one module per command | `cli/serve.ts` |

## Goals / Non-Goals

**Goals**
- **The contract is the bar.** The served store, and the store over HTTP,
  pass `pageStoreContract` unchanged. Everything the app does with a library
  then works on the served one.
- **Nothing new leaves the machine.** Page text goes only to 127.0.0.1, and
  a4.marsh.build still stores nothing.
- **Two libraries, never mixed.** Drafts, remembered pages, and tab messages
  each belong to one library.

**Non-Goals**
- **Protecting the library from other programs on the same machine.** A
  program running as the author can read the files directly. The token and
  origin checks keep out web pages, not local processes.
- **Serving more than one library per process,** or more than one person.

## Decisions

### 1. The served store is the OPFS store over a Node folder

`OpfsPageStore` already stores one Markdown file per page under `pages/` and
`trash/`, and passes the contract. `cli/serve.ts` gives it a directory
handle over `node:fs` that implements the six calls it makes:
- **Writes are atomic:** `createWritable` writes a temporary file and renames
  it over the page on `close()`, as the browser's commit does.
- **`getFile()`** returns the text, `lastModified`, and `size`.

`OpfsPageStore.open` gains `{ appDir: null }`, which keeps `pages/` and
`trash/` at the folder's root rather than under `a4/`. Writes take an
in-process lock per page: a promise chain keyed by name, which implements
`Locks`. So concurrent requests from tabs check their revision and write one
at a time, as Web Locks make tabs do in the browser.

**Alternative:** a new directory store over `FolderFs`. It would duplicate
the trash, rename, and name-claim rules the OPFS store already gets right.

### 2. The protocol: one POST per operation, protobuf both ways

`proto/a4/v1/store.proto`:

```proto
service PageStoreService {
  rpc ListPages(ListPagesRequest) returns (ListPagesResponse);
  rpc ReadPage(ReadPageRequest) returns (ReadPageResponse);
  rpc CreatePage(CreatePageRequest) returns (CreatePageResponse);
  rpc CreateUniquePage(CreateUniquePageRequest) returns (CreateUniquePageResponse);
  rpc WritePage(WritePageRequest) returns (WritePageResponse);
  rpc RenamePage(RenamePageRequest) returns (RenamePageResponse);
  rpc TrashPage(TrashPageRequest) returns (TrashPageResponse);
  rpc ListTrash(ListTrashRequest) returns (ListTrashResponse);
  rpc RestorePage(RestorePageRequest) returns (RestorePageResponse);
  rpc PurgePage(PurgePageRequest) returns (PurgePageResponse);
}
message StoreFailure { StoreErrorCode code = 1; string message = 2; string page = 3; string expected = 4; optional string actual = 5; string reason = 6; }
```

- **The transport:** `POST /a4.v1.PageStoreService/<Method>`, with
  `Content-Type: application/proto` and binary protobuf bodies. That's the
  shape of Connect's unary protocol, without adding Connect as a dependency.
- **Errors:** a store error comes back with status 409, 404, or 422 and a
  `StoreFailure` body. `RemotePageStore` throws the same `StoreError` class
  the browser's store would.
- **Network failures:** any other failure becomes `StoreUnavailableError`,
  so autosave's retry and unsaved status apply as they do now.
- **Where it lives:** `lib/persist/store/serve.ts` is the request handler.
  It's a function from a request to a response, over a `PageStore`, with
  no Node API. So the HTTP contract run can drive it in-process, and
  `cli/serve.ts` can wrap it in `node:http`.

### 3. Security: loopback, Host, Origin, token

- **Loopback:** listen on 127.0.0.1 only.
- **Host:** check the `Host` header against `127.0.0.1:<port>` and
  `localhost:<port>`, which defeats DNS rebinding.
- **Origin:** answer CORS only for allowed origins, by default
  `https://a4.marsh.build`. `--origin` adds one, such as
  `http://localhost:5173` for development. A request from any other origin,
  or with no `Origin`, gets 403.
- **Token:** `Authorization: Bearer <token>`, compared in constant time. The
  token is 32 random bytes, base64url, in `<folder>/.a4-serve-token` (mode
  0600), and reused across runs so a remembered connection survives a
  restart.
- **Preflights:** answer `OPTIONS` with `Access-Control-Allow-Origin` for
  the allowed origin, `Access-Control-Allow-Headers: authorization,
  content-type`, and `Access-Control-Allow-Private-Network: true`. Chromium
  may also ask the author to allow local network access, the first time.

### 4. The connect link and the remembered connection

- **The link:** `a4 serve` prints `<origin>/#serve=127.0.0.1:<port>.<token>`.
  The app reads `#serve=` beside `#s1.`, connects, switches, and clears the
  fragment.
- **What's remembered:** the address and token, in a new setting,
  `SETTINGS.servedLibrary`, kept in this browser's local storage. Disconnect
  clears it.
- **The token's reach:** it never goes to a4.marsh.build, and opens only
  this one library on this machine.
- **The Connect form** in the Pages panel takes the address and token, for
  when the link can't be clicked.

### 5. The workspace switches libraries

`#start`'s library setup becomes `#showLibrary(source)`, where `source` is
the browser's store or a `RemotePageStore`, with an id: `browser`, or
`served:127.0.0.1:4320`. Switching:
1. Reach the served library first (a listing), so one that can't be reached
   changes nothing.
2. Save and close both slots. A save that fails (the server stopped) leaves
   its draft in the library's own journal, recovered when the author returns
   to it. The folder stays connected, and a remembered file reopens.
3. Each slot's page is already remembered for the library being left
   (`openA`/`openB` for this browser's, `servedOpenA`/`servedOpenB` for the
   served one).
4. Build the new library:
   - its own `Journal` prefix (`a4:` for the browser, so existing drafts
     keep their keys, and `a4:served:<address>:` for the served one);
   - its own channel (`a4-pages`, or `a4-pages:<address>`);
   - its draft recovery;
   - its remembered pages.
5. Publish.

A failure to reach the server leaves the browser's library in place, with a
`served-unreachable` notice. Starting up does the same when the remembered
served library can't be reached.

**Alternative:** a second library shown beside the first, with its own ref
kind. Every `PageRef` consumer and library action would have to choose
between two libraries, which is a wide change for one switch.

### 6. Changes on disk: a poller in the workspace

- **When it runs:** only while the served library is shown and the tab is
  visible, every 2 seconds.
- **What it does:** it lists the served pages and compares their revisions
  with the last list. It raises the same `pagesChanged` and `pageSaved`
  events another tab's save would.
- **So existing paths handle it.** The list refreshes, an open page with no
  unsaved edits adopts the new text, and one with edits keeps both versions
  when it next saves.
- **The cost:** a 2-second poll and a 5-second bound leave room for a slow
  request. The tab is hidden most of the time anyway.

## Risks / Trade-offs

- **[Risk] Browsers restrict pages reaching localhost.**
  - Chromium allows `http://127.0.0.1` from an HTTPS page, with a
    private-network preflight and possibly a one-time permission prompt.
  - Firefox treats loopback as potentially trustworthy.
  - Safari's handling has varied by version. If a fetch fails, the
    unreachable notice names the browser setting or suggests Chrome.

  The task list proves Chromium in the built-in browser.
- **[Risk] Another site on the machine tries the server.** It's refused by
  origin and token. A local program could read the files directly anyway
  (see Non-Goals).
- **[Risk] A token in local storage.** It opens one library on one machine,
  and only from the allowed origins. Disconnect removes it.
- **[Trade-off] Two separate libraries.** Nothing syncs, so an author who
  wants both copies uses Export all and Import. That's stated in the README
  and the switch's description.
- **[Risk] Many tabs and an agent writing at once.** Revisions detect every
  lost update. The in-process lock serializes writes, and conflicts keep
  both versions, as they do across tabs today.

## Migration Plan

- **Nothing to migrate.** The browser's library keeps its keys (`a4:`),
  channel, and remembered pages.
- **Rollback:** reverting leaves an unused `servedLibrary` setting and any
  served folders on disk, which are plain Markdown.
