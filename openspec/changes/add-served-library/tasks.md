# Tasks

## 1. The served store

- [x] 1.1 Add `{ appDir: null }` to `OpfsPageStore.open`, which keeps `pages/` and `trash/` at the root of the folder it's given. Verify that the existing OPFS contract run still passes, and add a run with `appDir: null` over the fake OPFS.
- [x] 1.2 Add the Node directory-handle adapter (design decision 1):
  - `getDirectoryHandle`, `getFileHandle`, `entries`, and `removeEntry`;
  - `createWritable`, which writes a temporary file and renames it on `close()`;
  - `getFile`, with its text, `lastModified`, and `size`.

  Also add the in-process `Locks`. Run `pageStoreContract` against `OpfsPageStore` over a temporary folder, and verify it passes unchanged. Verify that a page is exactly `<folder>/pages/<name>.md`, and that a file written on disk is the next read's text.

## 2. The protocol

- [x] 2.1 Add `proto/a4/v1/store.proto`, with `PageStoreService`, its messages, `StoreErrorCode`, and `StoreFailure` (design decision 2). Run `pnpm proto`, and verify `pnpm proto:check` passes, with no breaking change to existing files.
- [x] 2.2 Add `lib/persist/store/serve.ts`, the request handler: a function from a method and protobuf bytes to a status and protobuf bytes, over a `PageStore`. It maps each `StoreError` to a `StoreFailure` and status. Also add `lib/persist/store/remote.ts`, with `RemotePageStore` over an injected `fetch`, which turns a `StoreFailure` back into the same error class. Run `pageStoreContract` against `RemotePageStore`, wired to the handler in the same process over a memory store, and verify it passes unchanged.

## 3. `a4 serve`

- [x] 3.1 Add `cli/serve.ts` and the `a4 serve <folder> [--port] [--origin] [--new-token]` command (design decisions 1 and 3):
  - listen on 127.0.0.1 only;
  - check `Host`, then `Origin` and preflights, then the token;
  - keep the token in `.a4-serve-token` (mode 0600), reused across runs;
  - print the address and the connect link;
  - exit 2 for a folder it can't use or a port that's taken.

  Add `a4 serve` to `a4 --help`.
- [x] 3.2 Test the running server, and verify each check:
  - `pageStoreContract` passes against `RemotePageStore` talking to a real `a4 serve` over HTTP, which is the item's bar;
  - a wrong token gets 401;
  - another origin, or none, gets 403;
  - `Host: attacker.example:4320` gets 403;
  - nothing is read or written on a refused request;
  - the token file is mode 0600 and the same after a restart, and `--new-token` changes it;
  - a port that's taken exits 2;
  - the server listens on 127.0.0.1 only.

## 4. Switching libraries

- [x] 4.1 Factor the workspace's library setup into `#showLibrary(source)` (design decision 5):
  - each library gets its own journal prefix, channel, and remembered open pages;
  - add `switchLibrary(source)` and the `served-unreachable` notice;
  - startup uses the remembered served library, or falls back to the browser's library with the notice.

  Test with a memory store standing in for the served one, and verify:
  - switching away and back reopens the browser library's pages;
  - a draft made on one library recovers and saves only into it;
  - an unreachable served library leaves the browser's library in place, with the notice;
  - every existing workspace test still passes.
- [x] 4.2 Add the poller for the served library (design decision 6). Test it with a fake scheduler and a store changed behind the workspace's back, and verify:
  - a new page is listed within 5 seconds;
  - an open page with no unsaved edits shows the new text;
  - one with unsaved edits keeps both versions when it saves;
  - nothing polls while the tab is hidden.

## 5. The app

- [x] 5.1 Add `SETTINGS.servedLibrary` and the `#serve=` fragment, read beside share links (design decision 4). Opening a connect link connects, switches, remembers the connection, and clears the fragment. Verify in the built-in browser, against a running `a4 serve` with `--origin http://localhost:5173`, that the link switches the Pages panel to the served pages and that the address bar no longer holds the token.
- [x] 5.2 Add the library switch to the Pages panel:
  - "This browser" or the served library, with its address;
  - the Connect form, for an address and a token;
  - Disconnect;
  - the unreachable notice, with the command to start the server.

  Verify each step in the built-in browser:
  - create "Brief" on the served library and type, and `<folder>/pages/Brief.md` holds the text;
  - switch back, and the browser's open page returns;
  - stop the server, and the notice shows on switching;
  - write `pages/Brief.md` on disk, and the sheet shows it within 5 seconds;
  - Disconnect, and a reload stays on this browser's library.

## 6. Docs

- [x] 6.1 Add a README section, "Served library":
  - the command and its options;
  - the folder layout;
  - the security model;
  - connecting, switching, and disconnecting;
  - what happens when the server is down;
  - that the two libraries don't sync.

  Also add `a4 serve` to the command table, update concept.md's "A server backend" item, and make it `docs/platform.md` roadmap step 7, built, with the Later section emptied. Verify the documented commands run as written and that `pnpm lint` passes.

## 7. End-to-end checks

- [x] 7.1 Run `pnpm check`, and verify it passes, CLI tests included.

## Workflow follow-up

- Commit, push, and check the CI and deploy runs.
- Archive the change and sync its specs.
