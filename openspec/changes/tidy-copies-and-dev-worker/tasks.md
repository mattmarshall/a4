# Tasks

## 1. One runner for the store contracts

- [x] 1.1 Add `lib/platform/testing/contract.ts` with `check` and `runEach(checks, prefix, open)` (design decision 1), and make `plugin-store-contract.ts` and `handle-store-contract.ts` use it, each keeping its own `runInBrowser()` and the handle contract its OPFS setup and cleanup; verify `plugin-store.test.ts` and `handle-store.test.ts` pass, `pnpm lint:unused` passes, and on localhost both `runInBrowser()` commands from their doc comments report "pass" for every check and leave no `a4-plugins-contract-*` or `a4-handle-contract-*` database behind

## 2. Neutral class names for the key and URL fields

- [x] 2.1 Rename `.penKey` and `.penKeyInput` to `.field` and `.fieldInput` in `components/ModelsPanel.module.css`, `PenPanel.tsx`, and `PluginInstallDialog.tsx`; verify `grep -rn penKey components app` finds nothing, `pnpm lint:css` passes, and on localhost the install dialog's URL field and a pen's key field have the same computed styles as before the rename

## 3. The library's action names in one module

- [x] 3.1 Export `NOT_READY` ("Storage isn’t ready yet.") from `lib/workspace/errors.ts` and `lib/workspace/index.ts`, use it in `workspace.ts`'s `NotReady` and in the four places `useWorkspace.ts` writes the sentence; verify `pnpm typecheck` passes, a `lib/workspace/errors.test.ts` case pins the sentence, and `grep -rn "Storage isn’t ready yet" lib components` finds only `errors.ts`
- [x] 3.2 Add `components/library-copy.ts` with `libraryActions` and `folderPicker` (design decision 3), moving each sentence word for word from `useWorkspace.ts` and the four names `Workbench.tsx` passes to `openInSlot` and `duplicatePage`, and use it in both; verify a new `components/library-copy.test.ts` pins every name and notice and the composed "Couldn’t move “Brief” to the trash: …" through `reportResult`, and that no `run("…")` or inline action string is left in `useWorkspace.ts` or those `Workbench.tsx` calls

## 4. No Vite client in the worker

- [x] 4.1 On localhost, before the change, confirm the dev server's `ort.webgpu.bundle.min.mjs` (the URL `transformers.web.js` imports) starts with an import from `/@vite/client`; then add `devWorkerSafeOrtImport()` to `vite.config.ts` (design decision 4: `apply: "serve"`, `enforce: "pre"`, only `onnxruntime-web/dist/ort.*.mjs`, rewriting the one variable `import()` to a template literal, and `this.error` unless exactly one is found), and verify the served module has no `/@vite/client` import and no `__vite__injectQuery`, and `pnpm build` and `pnpm check:bundle` pass
- [x] 4.2 On localhost, turn on Semantic repetition and verify it loads and scores a page; then change a CSS module and restore it while the worker runs, and verify the console shows no error from the worker

## 5. The review's round

- [x] 5.1 In `docs/tech-debt-review.md`, move the 2026-11-27 round's "Left for a later round" items into "Taken up by `tidy-copies-and-dev-worker`", remove that heading, and say in the round's intro that `harden-served-identity` and `tidy-copies-and-dev-worker` took up every item left; verify no "Left for a later round" heading remains in the file

## 6. Integration

- [x] 6.1 Run `pnpm check` (lint, tests, typecheck, proto check, build, bundle check, element build) and verify it passes

## Workflow follow-up

- Commit, push, and watch CI and the deploy to a4.marsh.build.
- Archive the change (no spec delta to sync).
