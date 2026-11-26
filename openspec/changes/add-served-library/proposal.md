# Proposal

## Why

A4's library lives in one browser. An agent working in a terminal can't add a
page to it, Firefox and Safari can't share it with Chrome, and the library is
lost if the browser's storage is cleared. The storage contract was written so
another backend could slot in: `PageStore`, with shared contract tests.
concept.md named the next backend: a server.

The `hosting` rule still stands: a4.marsh.build stores no page text. So the
server runs on the author's own machine. `a4 serve` keeps a library as
Markdown files in a folder and serves it to the app on localhost, so the page
never leaves the device.

## What Changes

- **`a4 serve <folder>`.** A local server for one library, kept as Markdown
  files.
  - Pages live in `<folder>/pages/<name>.md`, and trashed pages in
    `<folder>/trash/`.
  - It listens only on the loopback address, 127.0.0.1, by default on port
    4320.
  - It answers only the app's origin (`https://a4.marsh.build`, or another
    given with `--origin`), and only with the library's token.
  - It prints a connect link whose fragment carries the address and token,
    so neither reaches a4.marsh.build.
- **The protocol.** `a4.v1.PageStoreService`: one HTTP POST per store
  operation, with `a4.v1` protobuf bodies, and store errors as
  `a4.v1.StoreFailure`.
  - The browser side is `RemotePageStore`, which implements `PageStore`.
  - The server side reuses the OPFS page store over the folder through a
    Node adapter.
  - Both pass the library contract tests unchanged, which is this item's
    bar.
- **Switching libraries in the app.** The Pages panel gains a library
  switch: this browser's library, or the served library.
  - On the served library, everything a library does works against it:
    listing, opening, autosave, conflicts, Compare, create, rename, trash,
    restore, and export.
  - The browser's library stays as it was, and nothing is merged or copied.
  - Drafts are kept for each library separately, so a draft never saves into
    the other one.
- **Opening the connect link** switches to the served library, and A4
  remembers the address and token in this browser. Disconnect forgets them.
- **When the server is down,** the app says so and offers this browser's
  library. Edits made while it's unreachable stay as drafts, as when a save
  fails today. They save when the server is back.
- **Changes on disk show up.** While a served page is open, the app polls the
  server for changes, so a page an agent or an editor changes on disk
  appears within 5 seconds. An open page with no unsaved edits is updated;
  one with edits is kept, and the conflict is handled as today.

### Out of scope

- Any server on a4.marsh.build, or reached over the network. `a4 serve`
  never binds to anything but loopback.
- Syncing or merging the browser's library with the served one. To copy
  pages between them, use Export all and Import.
- Serving a repository folder (context files and letters). Open folder still
  covers repositories in Chromium.
- Accounts, users, or more than one library per `a4 serve`.
- HTTPS for the local server.

## Capabilities

### New Capabilities

- `served-library`: `a4 serve` and its folder layout, the
  `PageStoreService` protocol and its security (loopback only, origin, and
  token), the connect link, switching libraries in the app, what happens
  while the server is down, and changes on disk showing up in the app.

### Modified Capabilities

None. The browser's library starts and behaves as before, including its
backend selection (`page-storage`). The served library is a second library
the author switches to, and a4.marsh.build still stores nothing (`hosting`).

## Impact

- **Protos:** `proto/a4/v1/store.proto` adds `PageStoreService`, its request
  and response messages, and `StoreFailure`.
- **Store:**
  - `lib/persist/store/remote.ts` adds `RemotePageStore`, a `PageStore` over
    `fetch`.
  - `lib/persist/store/serve.ts` is the request handler.
  - `OpfsPageStore.open` gains an option to keep `pages/` and `trash/` at
    the root of the folder it's given.
- **Node:** `cli/serve.ts` adds the HTTP server and a directory-handle
  adapter over `node:fs`, plus a lock for writes within the process.
- **Workspace:**
  - The library's setup is factored out, so the workspace can switch
    stores.
  - Each library has its own journal prefix, tab channel, and remembered
    open pages.
  - A poller watches the served library's list.
- **UI:**
  - The Pages panel gains a library switch, a Connect form, and a notice
    when the server is unreachable.
  - The connect link's fragment (`#serve=…`) is read like a share link's.
- **Docs:**
  - README gains a section, "Served library".
  - concept.md and `docs/platform.md`: the server backend is built, as
    roadmap step 7, and the Later section is empty.
