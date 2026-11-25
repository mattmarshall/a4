# Tasks

## 1. Paper sizes in the page model

- [x] 1.1 In `lib/page/`, add `PAPER_SIZES`, `PaperId`, and `paper`/`paperW`/`paperH` on `PageSpec`, and `pageSpec(preset, paper)` with margins scaled by `paperW / 210` (design decision 1). Keep `PRESETS` as the A4 specs. Add tests, and verify they pass:
  - every preset's A4 grid is unchanged (80 × 60, 62 × 58, 75 × 58, 100 × 80);
  - Terminal A5 is 56 × 42 (2,352 cells, token ceiling 588) and A6 is 40 × 29 (1,160, ceiling 290);
  - Pica, Elite, and Dense on A5 and A6 match the design's table;
  - `PRESETS.terminal === pageSpec("terminal", "a4")`.
- [x] 1.2 Add `sizeOfName(name)` (design decision 2). Add tests, and verify they pass:
  - `card.a5.md`, `CARD.A5.MD`, `note.a6.mdc`, and the library name "Deploy note.a6" are sized;
  - `CLAUDE.md`, `a5.md` (no dot before the size), `x.a4.md`, and `x.a7.md` are A4.

## 2. Rendering every size

- [x] 2.1 Replace every use of `PAPER_W`/`PAPER_H` with the spec's paper, and remove the exports (design decision 3):
  - the WGSL `PAPER` becomes a `paper` uniform, mirrored in `UNIFORM_OFFSETS`;
  - `deform.ts` takes the paper, with hinges at `paperH / 3` and `2 · paperH / 3`, and crease and curl sizes scaled by `paperW / 210`;
  - the camera, picking, the paint frame and paper, the flat view, and the zoom helpers read the spec.

  Verify that `pnpm typecheck` passes and that the existing paper, paint, uniform, and geometry tests pass unchanged on A4, including the hinges at 99 and 198.
- [x] 2.2 Extend the renderer tests to A5 and A6, and verify they pass:
  - the isometry stays within 0.5% when folded and curled;
  - fully folded, the creases lie at 70/140 mm on A5 and 49.3/98.7 mm on A6, with no panel intersecting another;
  - picking on A6 maps the last row's first cell to row 29;
  - the paint texture's aspect matches the paper's.

## 3. The element

- [x] 3.1 Add the `size` attribute (`ATTRIBUTES.size`: a4, a5, a6; default a4) and derive the element's spec from the preset and size. Regenerate `types/a4-sheet.d.ts` with `pnpm gen:element-types`. Add element tests, and verify they pass:
  - `size="a5"` gives a 56 × 42 Terminal grid;
  - an invalid size falls back to A4;
  - changing `size` re-renders.

  Verify that `pnpm lint:element-types` passes.
- [x] 3.2 Print at true size per sheet: named `@page a4`, `@page a5`, and `@page a6` in `app/globals.css`, and the element's print root sets `page: <size>`. Verify in the browser's print preview that an A6 sheet prints as a 105 × 148 mm page and an A4 sheet as 210 × 297 mm, and update the README's element attribute table.

## 4. The sheet record

- [x] 4.1 Add `enum PaperSize` and `PageSpec.paper = 9` to `proto/a4/v1/sheet.proto`, run `pnpm proto`, and update the spec codec (design decision 5): it writes the paper, reads UNSPECIFIED as A4, and rejects cols or rows that disagree with `pageSpec(preset, paper)`. Add tests, and verify they pass:
  - an A5 sheet round-trips with its paper;
  - a record without a paper reads as A4;
  - a record claiming A5 with A4 rows is rejected;
  - an A5 page using 12 rows encodes to a 42 × 56 grid.

  Verify that `pnpm proto:check` passes against main.

## 5. Sizes in the app

- [x] 5.1 Give each Compare slot its own spec, `pageSpec(presetId, sizeOfName(page name))`, used by analysis, metrics, `SheetStage` (with `size`), and the sheet's label ("A5 page, 56 columns by 42 rows") (design decision 4). Verify that `pnpm typecheck` and the component tests pass.
- [x] 5.2 Make Fit to page use the active slot's spec, and confirm the fit plugin and the model host judge fit from the spec they're given. Add a host test, and verify it passes: an A5 result of 44 rows triggers a repair and one of 40 fits.
- [x] 5.3 Verify in the browser pane, using the folder stub from earlier changes:
  - a folder file `docs/auth-card.a5.md` opens as an A5 sheet (56 × 42, token ceiling ≈ 588) in 3D and flat;
  - Fold creases it at thirds;
  - a library page renamed "Deploy note.a6" becomes A6;
  - Compare with A4 in A and A5 in B shows both at their sizes;
  - the layout holds at 1,000 px in light and dark.

## 6. The desk judges on a size

- [x] 6.1 `judge(text, paper)`, `judgeFile(raw, paper)`, and `deskPage(paper)`, keeping `DESK_PAGE` as the A4 alias. In `lint.ts`, judge each file at `sizeOfName(path)` and add `PaperSize paper` to `LintedFile`. Add tests, and verify they pass:
  - `a4 lint docs/auth-card.a5.md` measures 70-character lines as 2 rows on the 56-column grid, out of 42 rows;
  - `note.a6.md` using 31 rows fails 2 over;
  - A4 results are unchanged.
- [x] 6.2 Letters on their size:
  - `Letter.paper` and rows on the letter's size;
  - `sealLetter` refuses Accept when the letter is over its size;
  - `letterPathAt(now, n, topic, paper)`;
  - the Letters group shows the size and rows out of the size's rows.

  Add tests, and verify they pass:
  - an A5 letter using 30 rows lists as 30 of 42;
  - an A6 letter using 31 rows can't be accepted (2 over);
  - delivery is unchanged.
- [x] 6.3 Mailroom sizes:
  - `size` (enum a4, a5, a6) in `lint_page` and `write_letter`'s input schemas;
  - `checkPage(text, paper)`, with `PageCheck.paper`;
  - `fileLetter(…, { paper })`, naming `…-<topic>.a5.md`;
  - an unknown size is an error result.

  Add tests, and verify they pass:
  - 45 rows on A5 reads "45 of 42 rows, 3 over";
  - an A5 card files as `2026-11-25-0930-auth.a5.md`;
  - an A6 postcard of 31 rows is refused 2 over;
  - "a3" is an error that writes nothing.

  Update the README's Mailroom section.

## 7. Stacks in the desk

- [x] 7.1 Add `STACKS_DIR`, `stackOfPath`, and the `"stack"` group to `lib/persist/folder/scan.ts`, ahead of context files. Add scan tests, and verify they pass:
  - `.agents/stacks/auth/01-charter.md` is a stack page of "auth";
  - `.agents/stacks/auth/old/x.md` and `.agents/stacks/Auth Notes/01.md` aren't;
  - stack pages aren't Other Markdown.
- [x] 7.2 Add `proto/a4/v1/stack.proto` (`StackLabel`), and add `StackPage`, `RepeatedLine`, `StackReport`, `LabelProblem`, `StackList`, and `LintReport.stacks = 5` to `lint.proto`, avoiding an import cycle (design decision 7). Run `pnpm proto`, and verify `pnpm proto:check` passes.
- [x] 7.3 Add `lib/desk/stacks.ts` with `readStacks(fs)`: the label, pages in name order, quarter-page counting, the outcome, and repeated lines by position (design decision 7). Re-export it from the desk index. On both folder adapters, add tests, and verify they pass:
  - two A4, one A5, and two A6 pages use 3 pages;
  - budget 2 using 2.5 fails 0.5 over;
  - an A5 page of 45 rows fails the stack, naming it 3 over;
  - a missing, unreadable, or zero-budget label warns with its reason;
  - a 50-character line on pages 1 and 3 is reported with both positions, and a 15-character one isn't;
  - the JSON never contains a page's text.
- [x] 7.4 Lint stacks: `a4 lint` on a folder judges each stack, prints one line per stack, fails over budget or a page over, and lists `StackReport`s in `--json`. Add CLI tests, and verify they pass:
  - a "billing" stack at 2.5 of 2 fails with exit status 1;
  - a stack within budget passes;
  - a stack page is checked as a page.

  Update the README's Page lint section.

## 8. Stacks in the app

- [x] 8.1 `FolderIndex` reads stacks beside letters into the folder snapshot. The Pages panel shows a **Stacks** group after Letters, with each stack's name, "1.75 of 3 pages", and outcome, and its pages in order with size and rows. The search box filters stack pages by path. Add workspace tests, and verify they pass. Then verify in the browser pane, with the folder stub, that a stack lists, a page opens at its size, an over-budget stack is marked, and the group reads well at 1,000 px in light and dark.

## 9. The command line

- [x] 9.1 Split `cli/a4.ts` into a dispatcher plus `cli/lint.ts` and `cli/letters.ts`, beside `cli/mailroom.ts` (design decision 9), with no change in behavior. Verify that every existing CLI test passes unchanged and that `pnpm lint:deps` and `pnpm lint:unused` pass.
- [x] 9.2 Add `cli/stacks.ts` with `a4 stacks [folder] [--json]` and `a4 stack <name> [folder] [--letter]`, plus usage. Add spawn tests, with the no-network preload, and verify they pass:
  - listing "auth" (1.75 of 3) and "billing" (2.5 of 2) with outcomes;
  - `--json` parses as an `a4.v1.StackList` without page text;
  - `a4 stack auth --letter` prints the letter, then `--- 01-charter.md ---` and its text, then the next page;
  - a failing stack still prints, with problems on stderr and exit status 0;
  - `a4 stack missing` exits 2;
  - every file's bytes and modification time are unchanged.

  Add a README "Stacks" section with the layout, the label, counting, judging, the app's group, the commands, and a session-start hook example.

## 10. The context X-ray

- [x] 10.1 Add `proto/a4/v1/xray.proto` (`ContextXray`, `XraySource`, `XraySourceKind`), run `pnpm proto`, and verify `pnpm proto:check` passes.
- [x] 10.2 Add `lib/desk/xray.ts` with `importsOf`, `ruleLoadsAtStart`, `frontMatter`, `indexText`, `memorySlice`, and `xrayReport` (design decision 8). Don't re-export it from the desk index; add its `cli-through-index` exception. Add tests, and verify they pass:
  - "See @docs/agents.md." yields `docs/agents.md`;
  - an import in backticks or a fenced block is ignored, and `user@example.com` isn't an import;
  - `@my\ notes.md` keeps its space;
  - a rule with `paths:` doesn't load, and one with malformed front matter does;
  - `disable-model-invocation: true` drops a skill;
  - descriptions are cut at 1,536 characters;
  - `MEMORY.md` slices at 200 lines or 25,600 bytes.
- [x] 10.3 Add `cli/xray.ts`: `a4 xray [folder] [--budget <pages>] [--json]`, walking as in design decision 8, with `HOME` and the managed path injectable for tests. Add spawn tests over a fixture home and repository, with the no-network preload, and verify they pass:
  - the user file, then the root `CLAUDE.md`, and not `src/CLAUDE.md`;
  - `AGENTS.md` only when no `CLAUDE` files are on the walk;
  - an import listed after its importer, and a missing import reported;
  - 260 `MEMORY.md` lines counted as 200;
  - four of five skills in one index;
  - 30 and 90 rows counted as 0.5 and 1.5 pages, total 2;
  - `--budget 5` over 6.25 pages exits 1, saying 1.25 over;
  - `--budget 0` exits 2;
  - `--json` parses as an `a4.v1.ContextXray` and doesn't contain "sk-test-123";
  - paths under the fixture home print as `~/…`;
  - the footnote names what isn't counted;
  - no file changes.
- [x] 10.4 Run `a4 xray` on this repository and record the result (pages, sources) in the README's new "Context X-ray" section, which covers what it reads, what it doesn't, `--budget` for CI, and privacy.

## 11. Documentation

- [x] 11.1 Add a README "Page sizes" section on the fold ladder:
  - the three sizes and their Terminal grids;
  - the name rule;
  - where sizes apply.

  Then:
  - add the Scripts rows for `a4 stacks`, `a4 stack`, and `a4 xray`;
  - mark roadmap step 4 built in `docs/platform.md`, with a summary like steps 1 to 3;
  - update concept.md's "Reams" entry to point at stacks.

  Verify with `grep -i` that none of these name a private outside system.

## 12. Integration checks

- [x] 12.1 Run `pnpm check` and verify:
  - it passes, with no new Biome warnings beyond the standing 43;
  - `check:bundle` reports the first load at no more than 20 KiB above today's 761 KiB, with no plugin or model library code.
- [x] 12.2 Run `openspec validate add-stacks --strict`, and verify it passes.

## Workflow follow-up

- Commit the change when asked, then push and archive it (syncing the new
  `page-stacks` and `context-xray` specs and the nine modified ones).
