# Proposal

## Why

The tech debt review has no open items, but the UI still writes some of its
English in two ways the copy modules were meant to end:
- **Notices and confirmations written inline.** Nineteen calls are left:
  - 14 in `Workbench.tsx`;
  - 2 each in `LibraryPanel.tsx` and `useModelLens.ts`;
  - 1 in `menus.tsx`.

  One of them says "page(s)".
- **Error text made by hand.** Nine places in five UI files turn an error
  into text with `error instanceof Error ? error.message : String(error)`
  instead of `describeError`. A browser error, such as storage running out
  or access refused, then shows the browser's own wording instead of A4's
  sentence. And a failed export says "Export failed: …", unlike every other
  failed library action, which says "Couldn’t <action>: <why>".

`library-copy.ts` was the first step. This change finishes it, so every notice
and confirmation is said once, beside its subject, with a test.

## What Changes

- **Notices and confirmations move into copy modules, by subject:**
  - **`library-copy.ts`:**
    - the page and library notices: saved, saving failed, created, copied
      into the library, the page text copied, exported, and an import too
      large;
    - the four confirmations: clearing a page, moving a page to the trash,
      deleting a page for good, and emptying the trash;
    - the names of two more actions, exporting the pages and importing a
      file.
  - **`desk-copy.ts`:** the two seal notices ("Sealed: accepted “…”.").
  - **`plugin-copy.ts`:** a pen's result (it fits, or it's still over) and
    a lens's failure ("Semantic repetition: …").
  - **A new `view-copy.ts`:** the notice that 3D needs WebGPU.
- **Every sentence keeps its words, except three corrections:**
  - Emptying the trash asks to delete "3 pages" or "1 page", not
    "3 page(s)".
  - A failed export says "Couldn’t export the pages: <why>", in the same
    form as the other failed library actions.
  - The reason in each of the nine hand-made places comes from
    `describeError`, so a browser error reads as A4's sentence. Any other
    error reads as before.
- **One way to report a failed library action:**
  - Export and import report their failures through `runReported`, as the
    other library commands report theirs through `reportResult`.
  - `runReported` is exported from `lib/workspace`'s index for this.
- **Tests pin every moved sentence and the three corrections.** One new
  test file each covers `desk-copy.ts` and `view-copy.ts`, and the
  existing tests for `library-copy.ts` and `plugin-copy.ts` grow.

## Capabilities

### New Capabilities

(None.)

### Modified Capabilities

- `page-export`: a failed Export all downloads nothing and says it couldn't
  export the pages, and why. Today's spec doesn't say what happens when an
  export fails.

The other two corrections ("1 page", and A4's sentence for a browser error)
change wording, not what any requirement asks for. The specs that cover
those messages (`page-library`'s trash, and the plugin specs' "refused with
the reason") hold as written.

## Impact

- **Code:**
  - `components/library-copy.ts`, `desk-copy.ts`, and `plugin-copy.ts`,
    plus a new `components/view-copy.ts`, with their tests;
  - `components/Workbench.tsx`, `LibraryPanel.tsx`, `ModelsPanel.tsx`,
    `PluginInstallDialog.tsx`, and `useModels.ts`;
  - `components/workbench/menus.tsx` and `useModelLens.ts`;
  - `lib/workspace/index.ts`, which exports `runReported`.
- **Specs:** `page-export` gains one requirement.
- **Nothing else changes:** no APIs, dependencies, stored data, protocols,
  or output of the `a4` command.

**Out of scope:**
- Static labels written in JSX, such as "Empty trash" or "Delete forever".
  Earlier changes kept these inline, and a label is said only where it
  shows.
- English that `lib/` writes, such as `describeImport`'s report and the
  errors' own sentences. Those are written once already, in `lib/`.
- Rewording beyond the three corrections. For example, "Saved" and
  "Copied “Brief” (1,204 characters)" keep their lack of a final period.
- The share and served notices, which `share-copy.ts` and `served-copy.ts`
  already hold.
