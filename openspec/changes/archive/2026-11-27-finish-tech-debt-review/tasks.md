# Tasks

## 1. A baseline, before the rewrite

- [x] 1.1 Before changing any code, on localhost with the current build: install the example Word length plugin, and store the origin-private file system's root (`navigator.storage.getDirectory()`) in `IdbHandleStore` under the id `compat-check`; verify both read back with the current code

## 2. The IndexedDB helper

- [x] 2.1 Add `lib/platform/idb.ts` with `IdbDatabase` (`run` and `entries`, and an upgrade that creates any listed store the database lacks); verify `pnpm typecheck` and `pnpm lint:code` pass
- [x] 2.2 Rewrite `IdbPluginStore` and `IdbHandleStore` on `IdbDatabase`, keeping database `a4-plugins` (stores `plugins` and `files`) and database `a4` (store `folders`) at version 1; add a `runInBrowser` contract for the handle store beside the plugin store's; verify `plugin-store.test.ts` passes unchanged and `pnpm lint:unused` passes

## 3. Ed25519 keys in Node

- [x] 3.1 Add `lib/models/signing-key-node.ts` (`SigningKey`, `newSigningKey`, `signingKeyFromPem`, `KeyFormatError`) and add it to `cli-through-index` in `.dependency-cruiser.cjs` with its reason; verify a new `signing-key-node.test.ts` that a new key's PEM reads back to the same raw 32-byte public key, a signature verifies with `node:crypto`, and an RSA key and non-key text each throw `KeyFormatError` with its problem
- [x] 3.2 Use it in `cli/plugin.ts` (`keygen` and `pack`), `scripts/build-example-plugins.ts`, and `lib/models/testing/packages.ts` (`testKey` returns a `SigningKey`); verify `cli/plugin.test.ts` passes unchanged, and `pnpm build:examples` signs both examples and `pnpm a4 plugin verify` accepts each

## 4. One poll loop

- [x] 4.1 Add `PollLoop` in `lib/persist/autosave/poll.ts`; verify a new `poll.test.ts` on the fake scheduler: it polls every interval while visible, skips while hidden, never starts a pass while one runs, sets no timer while `active()` is false, and sets none after `stop()`
- [x] 4.2 Run `LibraryPoller` (2,000 ms) and `FileWatcher` (1,000 ms, active while a file is watched) on `PollLoop`; verify `watch.test.ts` and `lib/workspace/served.test.ts` pass unchanged

## 5. The copy

- [x] 5.1 Add `SHARED_PILL`, `sharedShownOn(specs)`, `sharedSealFor(name)`, and `SHARE_LINK_UNREADABLE` to `components/share-copy.ts`, and use them in `Topbar.tsx`, `SharedBanner.tsx`, and `useSharedView.ts`; verify a `share-copy.test.ts` case for one page and a pair
- [x] 5.2 Add `components/served-copy.ts`: the switch's labels and titles, the Connect form's hint, field labels, and buttons, `badConnection(port)`, `BAD_CONNECT_LINK`, `unavailableCause`, `unavailableNotice`, and `connectFailed`; use them in `LibrarySwitch.tsx`, `Workbench.tsx`, `useServeLink.ts`, and `components/workspace/notices.ts`; verify `notices.test.ts` passes unchanged, and a new `served-copy.test.ts` checks `connectFailed` for each reason at 127.0.0.1:4320
- [x] 5.3 Verify `rg -n '“|’' components/library/LibrarySwitch.tsx components/workbench/useServeLink.ts components/workbench/useSharedView.ts components/workbench/SharedBanner.tsx` finds no user-facing sentence, and `rg -n 'Shared · not saved' components --glob '!*-copy.ts'` finds none

## 6. Connecting by hand

- [x] 6.1 Give `Workspace.connectServed` a `from: "link" | "form"`: for `"form"`, reach the server once first, and on `StoreUnavailableError` return `{ connected: false, reason, message }` with no setting written, no publish, and no notice; verify `served.test.ts` cases: a stopped server (not running, nothing remembered, this browser's library still shown, no notice), a refused token (`refused`, nothing remembered), a running server (connected, remembered, its pages shown), and the link while the server is stopped (remembered, with a `served-unreachable` notice, as before)
- [x] 6.2 Route the Connect form through `from: "form"` and `connectFailed`, keeping the form open with its fields filled on a failure, and the link through `from: "link"`; verify `pnpm typecheck` passes

## 7. The shared slot

- [x] 7.1 Add `kind` (`empty`, `library`, `file`) to `SlotSnapshot`'s variants, set in `SlotController` and `useWorkspace`'s first snapshot; verify `pnpm typecheck` and `lib/workspace` tests pass
- [x] 7.2 Add `SharedSlot` and `StageSlot` to `components/workbench/stage.ts`, build shared slots in `useSharedView.ts`, and type `Stage.slots`, `SharedView.slots`, `SheetStage`, `DocTitle`, and the page menu by `StageSlot`; replace each `ref === null && label !== null` with `kind === "shared"`; verify `stage.test.ts` cases that a shared pair's slots are `shared` and a single shared page's B is `empty`, and `rg -n 'ref === null && .*label' components` finds nothing

## 8. Docs

- [x] 8.1 Update the README's "Served library": the Connect form checks the server first, and when A4 can't use it, the form says why and remembers nothing, while the link it prints remembers and explains in a notice; verify the section reads correctly and its links resolve
- [x] 8.2 In `docs/tech-debt-review.md`, move the remaining items into "Taken up by `finish-tech-debt-review`", remove "Left for a later round", and update the status line to say every item is taken up; verify no "Left for a later round" heading remains

## 9. Integration

- [x] 9.1 Run `pnpm check` (lint, tests, typecheck, proto check, build, bundle check, element build) and verify it passes, with the first load still free of plugin and model code
- [x] 9.2 On localhost, after the rewrite: Word length, installed in 1.1, is listed and turns on its lens, and `compat-check` reads back from the new `IdbHandleStore` as a directory handle; then remove both
- [x] 9.3 On localhost, with `a4 serve` stopped, use the Connect form and verify it stays open, says `a4 serve` isn't running at 127.0.0.1:4320, and a reload still offers Connect a4 serve…; start `a4 serve`, enter a wrong token and verify it says the token was refused; then the right token connects and shows its pages
- [x] 9.4 On localhost, open a share link for one page and for a pair, and verify the pill, the banner, the captions, and the read-only title read as before

## Workflow follow-up

- Commit, push, and watch CI and the deploy to a4.marsh.build.
- Archive the change, syncing the `served-library` delta.
