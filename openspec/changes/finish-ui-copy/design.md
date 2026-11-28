# Design: finish-ui-copy

## Context

See proposal.md for why. What exists today:

| Piece | Where | Today |
| --- | --- | --- |
| Copy modules | `components/*-copy.ts` | One per subject: analysis, desk, plugins, share links, the served library, and (since `tidy-copies-and-dev-worker`) the library's action names. `desk-copy.ts`, `plugin-copy.ts`, and `share-copy.ts` are shared with the `a4` command, so they import `lib/` by relative path and nothing from React |
| Failed library actions | `lib/workspace/errors.ts` | `reportResult(result, notify, what)` and `runReported(action, notify, what)` both say "Couldn’t <what>: <why>", with `describeError(error)` as the reason. Only `reportResult` is exported from the index; `useWorkspace.ts` uses it for every page and folder command |
| Export and import | `Workbench.tsx` | Each catches its own error. Export says "Export failed: <message>"; import says "Couldn’t import “<file>”: <message>", with the message made by hand |
| The describer | `describeError` in `lib/workspace/errors.ts` | It returns a page store's or a model's error as written, gives A4's sentence for the browser's QuotaExceeded, NotAllowed, NotFound, and Abort errors, and otherwise returns the error's message. No A4 error class uses one of those four names |
| The nine hand-made reasons | Workbench (2), ModelsPanel (2), PluginInstallDialog (1, a local `message` helper used twice), useModels (2), useModelLens (2) | `error instanceof Error ? error.message : String(error)` |

## Goals / Non-Goals

**Goals**
- Each notice and confirmation is written once, in the copy module for its
  subject, and a test pins it.
- Every error the UI shows reads through `describeError`.

**Non-Goals**
- No change to `describeError`'s mapping or to any error's own sentence.
- No change to the toast component, its tones, or which tone each notice
  uses.
- No change to the confirmations' mechanism (`window.confirm`).

## Decisions

### 1. Each sentence goes to its subject's module

| Sentences | Module | Exports |
| --- | --- | --- |
| Saved, saving failed, created, copied into the library, the page text copied, exported, an import too large | `library-copy.ts` | `libraryNotices` |
| Clear the page, move to the trash, delete for good, empty the trash | `library-copy.ts` | `libraryConfirm` |
| Export the pages, import a file | `library-copy.ts` | `libraryActions.exportPages`, `libraryActions.importFile(name)` |
| Sealed: accepted or returned | `desk-copy.ts` | `sealedNotice(verdict, label)` |
| A pen's result, a lens's failure | `plugin-copy.ts` | `penResultNotice(name, result)`, `modelFailed(name, why)` |
| 3D needs WebGPU | new `view-copy.ts` | `NO_WEBGPU` |

Details:
- `sealedNotice` takes `"accepted" | "returned"`. `desk-copy.ts` can't import
  `SealVerdict` from `SealDialog.tsx`, a React file the `a4` command can't
  load. `SealVerdict` is the same union, so it's assignable.
- `penResultNotice` takes the fields it reads from `TransformResult`
  (`fits`, `rowsUsed`, `rowsAllowed`, `overBy`, `attempts`), as a `Pick`.
- `modelFailed(name, why)` takes `name` as `string | undefined` and writes
  "Model" when there's none, as the lens does today when no lens is on.
- `library-copy.ts` has its own small `plural`, like `desk-copy.ts`. Counts
  aren't grouped with commas, so "Exported 3 pages to …" reads as it does
  now. The copied text's character count keeps its grouping ("1,204
  characters").

*Alternative:* one `workbench-copy.ts` for everything the Workbench says.
The seal and pen notices would then sit apart from the rest of the
letters' and plugins' wording, which `desk-copy.ts` and `plugin-copy.ts`
hold so the app and the `a4` command say them the same way. Rejected.

*Alternative:* put the WebGPU notice in `library-copy.ts` or
`desk-copy.ts`. It's about the view, not the library or the desk. A small
module named for the View menu keeps each module's header true. Rejected.

### 2. `describeError` is the one describer

The nine places call `describeError` from `@/lib/workspace`:
- the Models panel's update check and remove;
- the install dialog's two errors (its `message` helper goes);
- `useModels`' start and download errors;
- the lens's scheduled and consented scores, through `modelFailed`.

It already handles model errors (`ModelError` keeps its message), and no
A4 error class uses one of the four browser error names. So an A4 error
reads as before, and only a browser error changes, to A4's sentence.

*Alternative:* a second describer for the model UI, in `lib/models` or
`plugin-copy.ts`. Two describers would drift, and `describeError` was
written as "a plain-English sentence for any error A4 can hit". Rejected.

### 3. Export and import report through `runReported`

`lib/workspace/index.ts` exports `runReported`, and the Workbench uses it:
- **Export:** the action exports the pages and saves the file, and its
  `what` is `libraryActions.exportPages` ("export the pages"). On success,
  `libraryNotices.exported(count, fileName)`.
- **Import:** the action reads the file and imports it, and its `what` is
  `libraryActions.importFile(name)` ("import “Brief.zip”"). On success,
  `describeImport`'s report, as now.
- **Too large:** a file over the limit is refused before it's read, as now,
  with `libraryNotices.importTooLarge(name, limit)`. The limit comes from
  `formatByteLimit`, as now. Like `folderPicker.pickFailed`, this sentence
  writes its own "Couldn’t import “…”:" start, because the reason isn't an
  error.

A storage that hasn't started still reaches the author: `exportAll` and
`importArchive` throw `NOT_READY`, and `runReported` reports it.

*Alternative:* make `exportAll` and `importArchive` return a `Result` and
go through `useWorkspace`'s `run`, like the page commands. `run` resolves to
nothing when there's no workspace, so "Storage isn’t ready yet." would no
longer be said. Rejected.

*Alternative:* keep each `try`/`catch` and compose the sentence in
`library-copy.ts`. That writes "Couldn’t <what>: <why>" a third time, beside
`reportResult` and `runReported`. Rejected.

## Risks / Trade-offs

- **A browser error now reads differently in the Models panel and the
  install dialog.** That's the intent. But a browser error whose own
  message said more than A4's sentence loses that detail. → `describeError`
  maps only four names, and each of its sentences already serves the
  library's notices. Any other error keeps its message.
- **An English sentence moves and changes by accident.** → Each module's
  test pins every moved sentence as it reads today, and the apply step
  checks the diff of every call site against them.
- **`desk-copy.ts` and `plugin-copy.ts` grow UI-only wording the `a4`
  command doesn't use.** Their headers already cover the app's wording, and
  depcruise keeps them free of React.

## Migration Plan

None: nothing stored, served, or built changes. Rollback is a revert.
