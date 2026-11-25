# Proposal: add-stacks

## Why

One page is A4's unit, but an agent's context is many pages. Today A4 can
judge one page, but it can't say:
- whether a set of pages fits a budget;
- what an agent is carrying before its first turn;
- how to say less with a smaller page.

Roadmap step 4 in `docs/platform.md` adds the three pieces that make context
a pile of paper a person can count: **stacks**, a **context X-ray**, and the
**fold ladder**.

## What Changes

- **Paper sizes: the fold ladder.**
  - A page can be A4, A5, or A6. Each fold halves the paper and keeps its
    shape. Cells keep their size, so text reads at the same point size, and
    the margins shrink with the paper.
  - On the Terminal preset that's 80 × 60 (4,800 cells), 56 × 42 (2,352),
    and 40 × 29 (1,160).
  - **A page's size comes from its name:** `card.a5.md` is an A5 page and
    `note.a6.md` an A6 page, and anything else is A4. This holds for folder
    files and library pages alike, so the editor, the 3D and flat sheet,
    print, the analysis, `a4 lint`, the mailroom, and Fit to page all judge a
    page on its own size.
  - No model folds a page: people and agents write the smaller page, and the
    desk decides whether it fits.
- **Stacks.**
  - A stack is a folder, `.agents/stacks/<name>/`, whose `.md` files are its
    pages in name order. A sheet lies on one stack only.
  - A label file, `stack.json` (an `a4.v1.StackLabel`), gives its purpose
    and its budget in pages. An A5 page counts as half a page, and an A6
    page as a quarter.
  - The desk judges a stack:
    - whether it's within its budget;
    - which pages are over their size;
    - which lines repeat across pages, since a stack says each thing once.
  - **In the app:** the folder view lists stacks in a **Stacks** group, with
    each stack's pages and budget use.
  - **On the command line:**
    - `a4 stacks` lists stacks and their budgets;
    - `a4 stack <name>` prints a stack's pages in order for a session-start
      hook, with `--letter` putting the latest accepted letter on top;
    - `a4 lint` checks stack pages and fails a stack over its budget.
- **The context X-ray.**
  - `a4 xray [folder]` photographs what a coding agent loads before its
    first turn. For Claude Code, that's:
    - the `CLAUDE.md` chain and its imports;
    - rules, auto memory, and skill descriptions.
  - It lays each source out as pages on the A4 Terminal page, and reports
    pages, rows, an estimated token count, and verdicts, source by source
    and in total.
  - `--budget <pages>` fails when start-up context exceeds a budget, for CI.
    `--json` prints an `a4.v1.ContextXray`.
  - It prints paths and numbers, never text. It reads only on the device.
- **Records.**
  - `PageSpec` gains a paper size (`a4.v1.PaperSize`), so every sheet record
    states its size.
  - New `proto/a4/v1/stack.proto` defines the label, `StackLabel`.
    `lint.proto` gains `StackReport` and `StackList`, and `LintReport` lists
    stacks.
  - New `proto/a4/v1/xray.proto` defines `ContextXray`.
- **The mailroom.** `lint_page` and `write_letter` take an optional `size`.
  An A5 letter is a card and an A6 letter a postcard, filed as
  `…-<topic>.a5.md` and judged on its size.

## Capabilities

### New Capabilities

- `page-stacks`: stacks in `.agents/stacks/`. It covers:
  - the folder, its order, and its label;
  - the page budget and how sizes count toward it;
  - judging a stack (budget, pages over, lines repeated across pages);
  - the folder view's Stacks group;
  - `a4 stacks` and `a4 stack`, with delivery and the letter on top;
  - lint of stack budgets.
- `context-xray`: `a4 xray`. It covers:
  - which start-up files it reads for Claude Code;
  - pages per source and in total;
  - the budget, the JSON record, and privacy.

### Modified Capabilities

- `page-grid`:
  - the sheet is A4, A5, or A6, not always 210 × 297 mm;
  - new requirements for the fold ladder's sizes and for a page's size
    coming from its name;
  - the token ceiling follows the page's size.
- `paper-view`: the letter fold creases at thirds of the sheet's own height.
- `a4-sheet-element`:
  - a `size` attribute;
  - printing makes a true-size page of the sheet's size.
- `sheet-tensor`: the page spec in a sheet record names its paper size, and
  the grid has the sized page's columns.
- `fit-to-page`: a result fits when it lays out within the rows of the
  page's size (60, 42, or 29 on Terminal).
- `folder-pages`: stack pages are listed in the Stacks group, not in Other
  Markdown.
- `letters`:
  - a letter is judged on its size;
  - Accept needs the letter to fit its size;
  - the Letters group shows rows out of its size.
- `page-lint`:
  - each file is measured and fails on its own size;
  - stack pages are checked;
  - a new requirement for stack budgets.
- `mailroom`:
  - `lint_page` and `write_letter` take `size`;
  - a filed letter's name carries a size other than A4;
  - "only letters that fit" uses the letter's size.

## Impact

- **Page geometry** (`lib/page/`): paper sizes beside presets, and a page
  spec for any preset and size.
- **Consumers of the A4 constants:** about 38 uses of `PAPER_W`/`PAPER_H` in
  the renderer, the paint code, the flat view, and geometry switch to the
  spec's paper. The WGSL shader's paper becomes a uniform.
- **Per-slot specs:** the Workbench uses one spec for both Compare slots
  today, and each slot gets its page's own.
- **Desk** (`lib/desk/`): sized judgment, stacks, and the X-ray, plus
  `cli/a4.ts` commands.
- **Folder scan:** a `stack` group.
- **Print:** a named `@page` for each size.
- **Protos:** `PageSpec` gains a field, a non-breaking addition, and there
  are two new files.
- **Dependencies:** none.
- **Privacy:**
  - The X-ray reads files under the user's home (`~/.claude`) and the
    repository, on the device only.
  - Its output holds paths and numbers, never file text.

## Out of Scope

- **A model that folds a page.** Fit to page judges an A5 or A6 page on its
  own size, but nothing compacts A4 into A5 automatically.
- **A canvas that shows a whole stack at once,** a creation flow for stacks
  in the app (stacks are folders and label files you write), and stacks in
  the browser library.
- **A mailroom tool for reading stacks.** A session-start hook delivers them
  with `a4 stack`.
- **X-rays of other harnesses** (other agents' start-up files), of session
  transcripts, of system prompts, and of tool definitions, none of which are
  files. The X-ray says what it doesn't count.
- **The X-ray in the app.** The browser can't read `~/.claude`.
- **Sizes beyond A6,** landscape pages, and other paper series (Letter,
  Legal).
- **Changing what the app opens by default.** New pages and New letter stay
  A4.
