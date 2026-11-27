# Tasks

## 1. The event message and the store

- [x] 1.1 Add `proto/a4/v1/plugin_event.proto` with `PluginEvent` (a oneof of `PluginChanged { string id = 1; }`) and its header comment naming the `a4-plugins` channel, run `pnpm proto`, and verify `pnpm proto:check` passes against main
- [x] 1.2 Add `hasFile(digest)` to `PluginStore` and `PluginFiles`, implemented with `count` in `IdbPluginStore` and `has` in `MemoryPluginStore` and the test `MemoryFiles`, and export `PLUGIN_CHANNEL = "a4-plugins"` from `lib/platform/plugin-store.ts`; verify a `plugin-store` test shows `hasFile` true after `putFile` and false after `deleteFile`

## 2. An installed plugin's client

- [x] 2.1 Split `installed-client.ts`'s `stop` into an internal restart and a `close` registered with `setCloser`: a closed client refuses calls, and a start that finishes after `close` closes its port and throws `NOT_FOUND` "‹name› was removed."; verify a new `installed-client.test.ts` case where `open` resolves after `closeClient`, so the port is closed once and the score rejects
- [x] 2.2 Keep a `checked` set of digests in the client: `status` and `prepare`'s skip check ask `hasFile` for a checked digest and fully check any other once, `start` always checks every file, and a mismatch drops the digest; verify tests that a second status after `prepare` reads no file bytes (a counting `MemoryFiles`), and that a file changed after the check makes `start` refuse with `NOT_READY` and the next status report not ready

## 3. The registry

- [x] 3.1 In `installed.ts`, add `loadOne(store, id)` (absent, damaged, or installed) with `loadInstalled` built on it, and make `InstalledPlugin.id` a `PluginId` minted from the verified card; verify the existing `installed.test.ts` and `registry.test.ts` pass unchanged
- [x] 3.2 Type the registry by `PluginId`: `#installed: Map<PluginId, …>`, `remove(id: PluginId)`, `checkForUpdate(id: PluginId)`, and a new `removeDamaged(id: string)`, in `registry.ts` and `registry-api.ts`; verify a never-called function in `registry.test.ts` with `// @ts-expect-error` on `registry.remove("example.word-length")` keeps `pnpm typecheck` passing, and the damaged-plugin test uses `removeDamaged`
- [x] 3.3 Give `RegistryDeps` a `channel: Channel | null` (`browserChannel(PLUGIN_CHANNEL)` in `pluginRegistry()`), post a `PluginEvent` after each `install`, `remove`, and `removeDamaged` finishes writing, and add `subscribe(listener)`, called after this tab's own changes; verify a test that a registry's install posts one decodable event on a `ChannelHub` channel and calls its subscriber once
- [x] 3.4 Hear events: decode each message (ignoring any that don't decode), and reconcile that id through a serial queue with `loadOne` (unregister when absent, list as damaged, re-register when the package bytes differ, nothing when they match), then call subscribers; verify `registry.test.ts` cases with two registries on one `MemoryPluginStore` and a `ChannelHub`, covering an install heard (B lists it and scores through it), a removal heard (B's host no longer lists it, and its sandbox's port is closed), an update heard (B's card is the new version), and a garbled message ignored

## 4. The copy

- [x] 4.1 Add `penPanel(card)` to `components/plugin-copy.ts`: the run label, progress line, credential prompt and "set" line, cost line, and key placeholder, with Fit to page's wording keyed on `FIT_TO_PAGE.id`; verify `plugin-copy.test.ts` asserts Fit to page's "Fit “Brief” to the page", "Claude is rewriting", cost line, and `sk-ant-…`, and an installed pen's instruction label, "‹name› is writing", no cost line, and "It goes only to api.example.com"
- [x] 4.2 Add `consentDialog(request)` (title, rows, and note, shaped like `installDialog`); verify tests that Fit to page's names Anthropic, `api.anthropic.com`, the model, "built into A4", the page, 5,400 characters, and the Anthropic API key, and that an installed remote pen's names its host, its name and version, its publisher note, and the page, and that an overlay's note says the scores tint the page
- [x] 4.3 Add `modelsPanel` to `plugin-copy.ts` with the Models panel's download note and progress, lens buttons, "Couldn’t start this model.", Remove's confirmation and notices, the damaged line, the install and update notices, and its buttons; verify a `plugin-copy.test.ts` case for each string that takes a value (a size, a name, a reason)

## 5. Pens and the consent dialog

- [x] 5.1 Add a pure `penCards(installed)` in `components/workbench/pens.ts` (Fit to page's card, then installed Transform cards by name), and rewrite `usePens` to return `readonly Pen[]` built by one function, dropping `fit` and `fitKey`; verify a `pens.test.ts` case for the order and the filtering of overlays
- [x] 5.2 Add `components/PenPanel.tsx`, rendering any `Pen` from `penPanel(card)`, asking for consent when the card is remote and otherwise running, with Use key and Forget key on every credential, and move `PenJobChip` into it; delete `FitToPage.tsx` and `PenControls.tsx`, and rename `ModelsPanel.module.css`'s `fit*` classes to `pen*`; verify `pnpm typecheck`, `pnpm lint:code`, `pnpm lint:css`, and `pnpm lint:unused` pass
- [x] 5.3 Make `ConsentDialog` render `consentDialog(request)` only, add `pendingConsent(lens, pens)` in `components/workbench/consent.ts` (the lens's pending score, else the first pen in `confirm`), and mount the one dialog in the Workbench, routing Send and Cancel to that request's own `send` and `dismiss`; verify a `consent.test.ts` case for each source and for none
- [x] 5.4 Rewire the Workbench, top bar, and focus bar to the pen list: Models panel slots from `pens`, and chips from `pens`; verify in the browser on localhost that Fit to page and the Semantic repetition summary still show in their cards, and that a running rewrite's chip shows on the top bar

## 6. The Models panel and `useModels`

- [x] 6.1 Key `useModels`'s `status`, `progress`, and `errors` as `ReadonlyMap<PluginId, …>`, take `PluginId` in `checkForUpdate` and `remove`, add `removeDamaged`, and type the Models panel's `activeLens`, `onScore`, and `slots` and the Workbench's `showPlugin` by `PluginId`; verify `pnpm typecheck` passes with no casts added (`pnpm lint:casts`)
- [x] 6.2 Refresh `useModels` from the registry's `subscribe` rather than after its own `install` and `remove`, and, while the registry isn't loaded, open a wake channel on `PLUGIN_CHANNEL` that loads it on the first message, refreshes, and closes; verify `pnpm build && pnpm check:bundle` passes with the registry still out of the first load
- [x] 6.3 Render the Models panel's words from `modelsPanel`; verify `rg -n '“|’' components/ModelsPanel.tsx` finds no user-facing sentences left inline (only the semantic summary's, which stays)

## 7. Docs

- [x] 7.1 Update the README: Fit to page's "Confirm every request" names the shared dialog and its Plugin row, and "Third-party plugins" says installs, updates, and removals reach other tabs within 2 seconds, Remove stops a starting sandbox, and model files are checked when downloaded and when the plugin starts; verify the sections read correctly and their relative links resolve
- [x] 7.2 In `docs/tech-debt-review.md`, move "Pen UI" and "Plugin lifecycle" out of "Left for a later round" into a "Taken up by `harden-pens-and-plugins`" list in the style of the served-protocol one; verify the remaining list names only the smaller copies, the Connect form, and the shared slot

## 8. Integration

- [x] 8.1 Run `pnpm check` (lint, tests, typecheck, proto check, build, bundle check, element build) and verify it passes
- [x] 8.2 In two localhost tabs, build and pack the example Word length and Hard wrap plugins (`pnpm build:examples`, then `pnpm a4 plugin pack` as the README's "Writing a plugin" shows), install Word length in one tab and verify it appears in the other within 2 seconds with its lens; turn that lens on in the second tab, remove the plugin in the first, and verify the second drops it and its lens turns off; install Hard wrap, then update it and verify the other tab lists the new version
- [x] 8.3 On localhost, open Fit to page's confirmation with a fake key and verify it names Anthropic, `api.anthropic.com`, the model, "built into A4", the page, and its characters, and that Cancel sends no request (the network log shows none to `api.anthropic.com`)

## Workflow follow-up

- Commit, push, and watch CI and the deploy to a4.marsh.build.
- Archive the change, syncing the `installed-plugins` and `model-plugins` deltas.
