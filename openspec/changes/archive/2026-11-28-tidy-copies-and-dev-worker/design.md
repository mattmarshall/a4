# Design: tidy-copies-and-dev-worker

## Context

See proposal.md for why. The code this touches:

| Piece | Where | Today |
| --- | --- | --- |
| Store contracts | `lib/platform/testing/plugin-store-contract.ts` and `handle-store-contract.ts` | Each defines `check(condition, message)` and a `runInBrowser()` that, for every check, opens the Idb store on a fresh `crypto.randomUUID()` database, runs the check, closes the store, records "pass" or "FAIL: …", and deletes the database. The handle contract's checks also take two handles, so it builds them first and removes its OPFS folder after. Node runs the same lists against the memory stores |
| Key form classes | `ModelsPanel.module.css`: `.penKey` (a 6 px grid) and `.penKeyInput` (the monospace text field) | `PenPanel.tsx` uses both for its key forms. `PluginInstallDialog.tsx` uses both for its URL form |
| Action names | `useWorkspaceApi`'s `run(what, command)` reports a failure through `reportResult` as "Couldn’t <what>: <why>" | The page and folder commands' names are inline strings in `useWorkspace.ts`. `Workbench.tsx` passes four more into `openInSlot` and `duplicatePage`. The served commands use `servedActions` from `served-copy.ts`. The folder picker's two notices are inline too |
| Not ready | `lib/workspace/workspace.ts`'s private `NotReady` says "Storage isn’t ready yet." | `useWorkspace.ts` writes the same sentence four times, for a command called before the workspace exists |
| The dev worker | The Semantic repetition worker imports `@huggingface/transformers`, which imports `onnxruntime-web/webgpu`. The dev server serves it from `node_modules` as `ort.webgpu.bundle.min.mjs`, unoptimized | Its one variable import, `import(/*webpackIgnore:true*/ /*@vite-ignore*/a)`, loads the WebAssembly glue from `wasmPaths.mjs`. In dev, Vite's import analysis turns it into `__vite__injectQuery(a, 'import')` and prepends `import { injectQuery as __vite__injectQuery } from "/@vite/client"`. For a classic worker it would inline the helper; for a module worker it imports the client |

## Goals / Non-Goals

**Goals**
- Each copy said once, with the same words and look as before.
- No Vite client in the worker in development, with no change to builds.

**Non-Goals**
- No change to what the contracts check, or to their results.
- No change to `reportResult` or the "Couldn’t <what>: <why>" shape.
- No new test runner or test glob for build tooling.

## Decisions

### 1. One runner, and each contract keeps its entry point

`lib/platform/testing/contract.ts` exports:
- `check(condition, message)`;
- `runEach(checks, prefix, open)`, where `checks` is a list of
  `[name, run]` with `run(store)`, and `open(dbName)` makes a store with
  `close()`.

`runEach` names each database `<prefix>-<uuid>` and keeps today's order:
run, close, record, delete. It returns the same
`Record<string, string>`.

The handle contract keeps its setup and cleanup, the OPFS root, a folder,
and `removeEntry` in a `finally`. It adapts its two-argument checks with
`map(([name, run]) => [name, (store) => run(store, handles)])`.

Each file keeps its own `runInBrowser()`, marked `@public`, so the console
command in each doc comment still works.

*Alternative:* a single `runInBrowser(kind)` exported from one file. That
would change the documented console commands and couple the two stores'
imports. Rejected.

### 2. Neutral class names, not a second copy

The two classes are renamed `.field` and `.fieldInput`, and both components
use them. `.penControls` and `.penProgress` stay, because only the pen panel
uses them. A selector stays camelCase, as stylelint requires for modules.

*Alternative:* give the dialog its own `.urlForm` and `.urlInput` with the
same declarations. That's the duplication this item is about. Rejected.

### 3. `library-copy.ts` beside the other copy modules

`components/library-copy.ts`, like `served-copy.ts`, imports by relative
path, so Node's test runner loads it. It exports:
- `libraryActions`, with fixed names (`createPage`, `restorePage`,
  `purgePages`, `openPageB`, `swapPages`, `reconnectFolder`, `closeFolder`,
  and the default `openPage`) and functions for the ones that take a name:
  - `trashPage(name)`;
  - `openNamed(label)`;
  - `duplicate(name)`;
  - `copyIntoLibrary(path)`;
  - `copyAToB`;
- `folderPicker`, with the two notices: the browser didn't show a picker,
  and couldn't open the folder, with or without the hint to try the
  repository folder.

The words are moved, not rewritten. A test pins each one, and the composed
"Couldn’t move “Brief” to the trash: …" through `reportResult`.

The not-ready sentence is lib's own: `lib/workspace/errors.ts` exports
`NOT_READY = "Storage isn’t ready yet."`. `NotReady` uses it, and
`useWorkspace.ts` returns or throws it, in the four places it now writes
it.

*Alternative:* put the action names in `lib/workspace`. Lib's English is
error sentences, and the components say what the author was doing. The
served names already live in `components/`. Rejected.

### 4. Rewrite the one call before import analysis sees it

A plugin in `vite.config.ts`, `devWorkerSafeOrtImport()`, has
`apply: "serve"` and `enforce: "pre"`. It transforms only ids matching
`onnxruntime-web/dist/ort.*.mjs`, and rewrites:

```
import(/*webpackIgnore:true*/ /*@vite-ignore*/a)
  →  import(/*webpackIgnore:true*/ /*@vite-ignore*/`${a}`)
```

The identifier is matched, not fixed. The comments stay, because Vite
rewrites only the expression after them. Why this is enough:
- A template literal matches Vite's string-URL test.
- `${a}` has no extension, so Vite counts it a JavaScript request and adds
  no `?import` query. So import analysis neither rewrites the call nor
  imports the helper.
- Vite's dynamic-import-vars plugin excludes `node_modules` by default, so
  it leaves the template alone.
- The value is unchanged: `wasmPaths.mjs` is an absolute URL, which
  `injectQuery` already left as it was.

The plugin calls `this.error` unless exactly one such call is found. The
message names the plugin, as `keepWindowGuardInWorkers` does, so an ONNX
runtime update that changes the call can't silently bring the client back.

*Alternatives:*
- Making the worker classic. Vite would inline the helper, but the worker
  imports ES modules. Rejected.
- Rewriting Vite's output after import analysis. Import analysis runs after
  every user plugin, so that would take a middleware around the dev
  server's transform. Rejected.
- Guarding `/@vite/client` against a missing `document`. It's Vite's
  module, and it would still open an HMR connection per worker. Rejected.

## Risks / Trade-offs

- **The dev server might optimize the ONNX runtime later.** For example, a
  vinext or Vite update might pre-bundle `@huggingface/transformers`. The
  id filter would then miss the chunk in `node_modules/.vite/deps`, and the
  client would quietly return to the worker. → The integration task checks
  the served module directly. The plugin's doc comment says where the code
  is served from, so the next person knows to widen the filter.
- **A hard error in dev on an ONNX update.** It stops only the worker's
  modules from loading, not the app, and the message says what to review.
  This is the same trade `keepWindowGuardInWorkers` makes in the build.
- **Renaming classes a test or another stylesheet reads.** `penKey` and
  `penKeyInput` appear only in the two components and the module. The
  apply step checks this again with `grep`.

## Migration Plan

None: nothing stored, served, or built changes. Rollback is a revert.
