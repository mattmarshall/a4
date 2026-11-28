# Proposal

## Why

The 2026-11-27 round of `docs/tech-debt-review.md` has two items left, after
`harden-served-identity` took up the served library's:
- **Smaller copies:**
  - the two store contracts repeat `check` and the `runInBrowser` loop;
  - the plugin install dialog styles its URL form with the pen panel's key
    classes;
  - the page commands' action names are written inline in `useWorkspace.ts`,
    while the served library's come from `served-copy.ts`.
- **Vite's client runs inside the Semantic repetition worker in
  development.** The ONNX runtime has one variable `import()`. Vite's dev
  server rewrites it with a helper it imports from `/@vite/client`. That
  client then runs in the worker, opens its own HMR connection, and logs an
  error on every CSS hot update, because a worker has no `document`.

Taking up both empties the list.

## What Changes

- **One runner for the store contracts:**
  - `lib/platform/testing/contract.ts` holds `check` and the loop that runs
    each check against a fresh IndexedDB database, closes the store, and
    deletes the database.
  - The plugin and handle store contracts use it. Each keeps its
    `runInBrowser()`, with the same results, from the dev console.
- **The install dialog has its own class names:** `.penKey` and
  `.penKeyInput` become `.field` and `.fieldInput` in
  `ModelsPanel.module.css`, used by the pen panel's key forms and the install
  dialog's URL form. The look is unchanged.
- **The library's action names in one module:**
  - A new `components/library-copy.ts` names what each page and folder
    command was doing when it failed. The notice is still "Couldn’t
    <action>: <why>".
  - Both `useWorkspace.ts` and the names `Workbench.tsx` passes in (open,
    duplicate, copy into the library, copy page A into B) use it.
  - The folder picker's two notices move there too.
  - "Storage isn’t ready yet." is written once, in `lib/workspace`, and
    `useWorkspace.ts` uses it.
  - Every sentence reads as it does now.
- **No Vite client in the worker:**
  - A dev-only Vite plugin rewrites the ONNX runtime's one variable
    `import()` so the dev server needs no helper for it.
  - It stops with an error if an ONNX runtime update changes that call.
  - Builds are unchanged.
- **The review's round is closed:** its "Left for a later round" list goes
  under "Taken up by `tidy-copies-and-dev-worker`", and the round's intro
  says no item remains.

## Capabilities

### New Capabilities

### Modified Capabilities

(None: nothing a person sees or does changes, so `skip_specs` is set.) The
notices keep their words, the panels keep their look, and Semantic
repetition loads and scores as before.

## Impact

- **Code:**
  - `lib/platform/testing/` (a new `contract.ts`, and both contracts);
  - `components/ModelsPanel.module.css`, `PenPanel.tsx`, and
    `PluginInstallDialog.tsx`;
  - a new `components/library-copy.ts` with a test;
  - `components/workspace/useWorkspace.ts` and `components/Workbench.tsx`;
  - `lib/workspace/workspace.ts` and `lib/workspace/errors.ts` (the not-ready
    sentence);
  - `vite.config.ts`.
- **Docs:** `docs/tech-debt-review.md`.
- **Nothing else changes:** no APIs, dependencies, stored data, protocols,
  or production output.

**Out of scope:**
- Other inline English in `Workbench.tsx`, such as the import notices,
  because no command names it.
- The install dialog's other static text, which only that dialog says.
- The page store contract in `lib/persist/store/testing/contract.ts`. It
  runs under `node:test` and has no browser runner.
- Testing the Vite plugin under `pnpm test`. Like the build's
  `keepWindowGuardInWorkers`, it lives in `vite.config.ts`, outside the
  test globs. Its error is the guard against an ONNX runtime update.
