# Design: add-stacks

## Context

See proposal.md for why, and the spec deltas for behavior. The code this
builds on:

| Piece | Where | What changes |
| --- | --- | --- |
| Page geometry | `lib/page/geometry.ts` (`PAPER_W = 210`, `PAPER_H = 297`), `lib/page/spec.ts` (`derive`, `PRESETS`, four presets on A4) | Paper becomes a dimension beside the preset |
| A4 constants in use | About 38 uses of `PAPER_W`/`PAPER_H`: `lib/render/paper/` (camera, pick, deform with `HINGE_TOP = 99` and `HINGE_BOTTOM = 198`, a WGSL `const PAPER`), `lib/render/paint/` (frame, paper), `lib/render/element/flat-view.ts`, `geometry.ts` zoom helpers | Each reads the spec's paper |
| One spec for both slots | `components/Workbench.tsx`: `const spec = PRESETS[presetId]`, shared by slots A and B, analysis, metrics, and Fit to page | One spec per slot |
| The element | `lib/render/element/contract.ts` (`ATTRIBUTES.preset`), `state.ts` (`spec: PRESETS[…]`) | A `size` attribute |
| Print | `app/globals.css`: `@page { size: a4 }` | A named `@page` per size |
| Sheet record | `proto/a4/v1/sheet.proto`: `PageSpec { preset = 8, cols, rows, cell…, margin… }` | A `paper` field |
| The desk | `lib/desk/judge.ts` (`DESK_PAGE = PRESETS.terminal`, `judgeFile`), `lint.ts`, `letters.ts` (`sealLetter` checks fit), `mailroom.ts` | Judging takes a size |
| Folder groups | `lib/persist/folder/scan.ts` (`fileGroup`: letter, context, other), `lib/workspace/folder-index.ts` (`#readLetters`) | A `stack` group, and stacks read beside letters |
| The command | `cli/a4.ts`: 372 lines, with lint, letters, and mailroom | Three more commands |

**Claude Code's start-up loading** comes from the official memory, skills,
and subagents documentation (code.claude.com/docs/en/memory, …/skills,
…/sub-agents), as checked on 2026-11-25. Decision 8 records what the docs
leave open.

## Goals / Non-Goals

**Goals**
- **One rule for a page's size,** read from its name and honored by every
  surface that judges, renders, or files a page.
- **Stacks that stay physical:** one sheet, one stack, with the desk
  counting paper, not rows.
- **An X-ray that's honest about its limits:** it counts only files it can
  read, and says what it leaves out.

**Non-Goals**
- Windows paths for the X-ray. Managed policy paths are listed per OS, but
  the walk and the tests target macOS and Linux.
- Reading Claude Code's settings (`claudeMdExcludes`, the project
  instructions setting, `autoMemoryDirectory`). The X-ray assumes the
  defaults and says so.
- Any change to the app's default page: New page and New letter stay A4.

## Decisions

### 1. Paper is a dimension beside the preset

- **New types in `lib/page/`:**
  - `PAPER_SIZES = { a4: 210 × 297, a5: 148 × 210, a6: 105 × 148 }` and
    `PaperId = "a4" | "a5" | "a6"`;
  - `PageSpec` gains `paper: PaperId`, `paperW`, and `paperH`;
  - `pageSpec(preset, paper)`, memoized, derives the grid as `derive` does,
    with every minimum margin scaled by `paperW / 210`.
- **The grids:**
  - Terminal: A5 is 56 × 42 and A6 is 40 × 29.
  - Pica: 44 × 41 on A5 and 31 × 28 on A6.
  - Elite: 53 × 41 and 37 × 28.
  - Dense: 70 × 56 and 50 × 39.
- **`PRESETS` stays** as the A4 specs (`PRESETS[id] === pageSpec(id, "a4")`),
  so callers that mean A4 don't change.
- **`PAPER_W` and `PAPER_H` go away** as importable constants. Each use reads
  `spec.paperW`/`spec.paperH`, so the type checker finds every place that
  assumed A4.
- **Alternative: A5 and A6 as more presets.** Rejected: size and typeface
  are independent choices. A Pica A5 card is a real thing, and presets would
  multiply to twelve.
- **Alternative: scale margins by 1/√2 per fold.** Rejected in favor of the
  exact paper ratio: it gives the same grids, and it states the rule in
  millimeters.

### 2. A page's size comes from its name

- **The rule:** `sizeOfName(name)` in `lib/page/` strips a trailing `.md` or
  `.mdc`, then matches `/\.(a5|a6)$/i`. Anything else is A4.
- **Folder files and library pages share it:** a library page "Deploy
  note.a6" is A6. Page names already allow dots, though not a leading one.
- **Renaming changes the size.** A rename that moves a page off its size
  changes how it's judged, which is the point: the name is the label on the
  paper.
- **Alternative: front matter or a marker line.** Rejected: it would count
  toward the page's rows and need parsing everywhere text is judged.
- **Alternative: a size picker per page, stored aside.** Rejected: folder
  files and the CLI would have nowhere to keep it, and any tool can read a
  name.

### 3. Rendering every size

- **The shader:** its `const PAPER` becomes a `paper: vec2f` field in the
  `Uniforms` struct, kept in step with `UNIFORM_OFFSETS` in `uniforms.ts`.
- **`deform.ts`:**
  - it takes the paper's size;
  - the hinges move to `paperH / 3` and `2 · paperH / 3`, which is still 99
    and 198 on A4, so the A4 fold is unchanged;
  - the crease radii and the curl's reach scale with `paperW / 210`.
- **The isometry tests** run on all three sizes.
- **The rest of the renderer:**
  - the mesh keeps normalized UVs;
  - the camera fits the paper's size;
  - picking maps a UV to the paper's millimeters;
  - the paint frame sizes its texture from the paper;
  - the flat view sets its width and height from the spec.
- **The element:**
  - `ATTRIBUTES.size` is a `choice` of a4, a5, or a6, default a4;
  - `state.ts` derives `spec = pageSpec(preset, size)`;
  - `types/a4-sheet.d.ts` is regenerated.
- **Print:** `globals.css` declares `@page a4 { size: a4 }`, `@page a5 {
  size: a5 }`, and `@page a6 { size: a6 }`. Each element's print root sets
  `page: <size>`, so a mixed print job gets true-size sheets.

### 4. A spec per slot in the app

- **In the Workbench:**
  - `specA` and `specB` are `pageSpec(presetId, sizeOfName(slot page
    name))`;
  - `useAnalysis`, `MetricsPanel`, `SheetStage`, and Fit to page take the
    slot's spec;
  - the sheet's label reads "A5 page, 56 columns by 42 rows".
- **The preset menu** keeps showing A4 grids, since the preset is the
  typeface choice.
- **Compare** with different sizes in A and B works, because each sheet
  carries its own spec.

### 5. The sheet record names its paper

- **The proto:**
  - `enum PaperSize { PAPER_SIZE_UNSPECIFIED = 0; PAPER_SIZE_A4 = 1;
    PAPER_SIZE_A5 = 2; PAPER_SIZE_A6 = 3; }` in `sheet.proto`;
  - `PageSpec.paper = 9`.
- **The codec:**
  - `specToProto` writes the paper;
  - `specFromProto` reads UNSPECIFIED as A4, rebuilds
    `pageSpec(preset, paper)`, and rejects a record whose cols and rows
    disagree with it.
- **Compatibility:** an additive field, so `buf breaking` against main
  passes, and old records read as A4.
- **Plugins** receive the spec in the `Sheet`. The model host already
  decides fit from the spec it's given, so Fit to page fits A5 to 42 rows
  without a plugin change beyond reading `spec.rows`. The task checks this.

### 6. The desk judges on a size

- **Judging:**
  - `judge(text, paper = "a4")` and `judgeFile(raw, paper)` use
    `pageSpec("terminal", paper)`;
  - `deskPage(paper)` replaces `DESK_PAGE` (kept as the A4 alias).
- **`lint.ts`:**
  - each file is judged at `sizeOfName(path)`;
  - `LintedFile` gains `PaperSize paper = 5`;
  - `LintReport` gains `repeated StackReport stacks = 5`, from `stack.proto`.
- **Letters:**
  - `readLetters` reports rows on the letter's size;
  - `sealLetter`'s over-page refusal uses the letter's size;
  - `Letter` gains `PaperSize paper = 6`;
  - `letterPathAt(now, n, topic, paper)` adds `.a5` or `.a6` before `.md`.
- **The mailroom:**
  - `checkPage(text, paper)` and `fileLetter(…, { paper })`;
  - the tools declare `size: { enum: ["a4", "a5", "a6"] }`;
  - an unknown size is an argument error, so an error result that writes
    nothing;
  - `PageCheck` gains `PaperSize paper = 7`.

### 7. Stacks

- **On disk:** `.agents/stacks/<name>/`, where the name matches
  `^[a-z0-9]+(-[a-z0-9]+)*$` and is at most 40 characters.
  - The pages are the `*.md` files directly inside, ordered like letters (by
    name without `.md`).
  - `stack.json` is the label.
  - Subfolders are ignored.
- **The records:**
  - `proto/a4/v1/stack.proto` holds only the label file's format,
    `StackLabel`.
  - The reports live in `lint.proto` beside `LintReport`, which lists them.
    `lint.proto` imports `stack.proto`, and the reports need `LintOutcome`
    and `Unreadable` from `lint.proto`. Putting them in `stack.proto` would
    make the two files import each other, which proto forbids. Moving the
    enums out of `lint.proto` would break buf's FILE compatibility rules.

  ```proto
  message StackLabel { string purpose = 1; uint32 budget_pages = 2; }  // stack.proto
  // lint.proto:
  message StackPage {
    string path = 1; PaperSize paper = 2; uint32 rows_used = 3; uint32 page_rows = 4;
    LintOutcome outcome = 5; AnalysisReport report = 6; Unreadable unreadable = 7;
  }
  message RepeatedLine { repeated string pages = 1; repeated uint32 lines = 2; }  // positions only, never text
  message StackReport {
    string name = 1; StackLabel label = 2; LabelProblem label_problem = 3;
    repeated StackPage pages = 4; double pages_used = 5; double over_by_pages = 6;
    LintOutcome outcome = 7; repeated RepeatedLine repeated_lines = 8;
  }
  enum LabelProblem { LABEL_PROBLEM_UNSPECIFIED = 0; LABEL_PROBLEM_MISSING = 1; LABEL_PROBLEM_UNREADABLE = 2; LABEL_PROBLEM_NO_BUDGET = 3; }
  message StackList { repeated StackReport stacks = 1; bool partial = 2; }
  ```

- **Counting:** page weights are A4 = 4, A5 = 2, A6 = 1 quarter pages,
  summed as integers and divided by 4 for display. That avoids
  floating-point sums like 0.1 + 0.2. The pages used are 0.25, 0.5, 0.75,
  and so on.
- **Repeated lines:**
  - each page's lines are trimmed at both ends;
  - lines of at least 20 characters are hashed per page;
  - a line found on two or more pages is reported with each page and its
    1-based line number.
  - Text output names the pages and lines; JSON carries positions. Neither
    quotes the line, following the lint report's no-text rule.
  - The app's Stacks group can show the line, on the device.
- **The folder scan:** `scan.ts` gains `STACKS_DIR`, `stackOfPath(path)`
  (the name, or null), and the `"stack"` group, checked before context
  files.
- **In the app:**
  - `FolderIndex` reads stacks beside letters with
    `readStacks(fs) → StackReport[]` from `lib/desk/stacks.ts`;
  - the Stacks group shows each stack, with pages listed in order under it;
  - opening a page opens it as any folder file, at its size.
- **On the command line,** `cli/stacks.ts`:
  - `a4 stacks [folder] [--json]` lists stacks;
  - `a4 stack <name> [folder] [--letter]` delivers one. Each page's exact
    text follows a `--- <file name> ---` line. `--letter` first prints
    exactly what `a4 letters --latest` prints, sharing its function.
  - Problems go to standard error, and the exit status is 0, so a hook
    never fails a session.
- **Alternative: a manifest of references.** The owner's choice was the
  folder. A sheet on one stack is written for that stack's reader, and the
  desk can then judge the stack's repetition as a whole.

### 8. The context X-ray

- **Pure logic in `lib/desk/xray.ts`,** with no Node:
  - `importsOf(text)`: `@path` tokens at the start of a line or after
    whitespace, outside code spans and fenced blocks, with `\ ` as an
    escaped space and trailing `.,;:!?)` dropped;
  - `ruleLoadsAtStart(text)`: no `paths` key in its front matter (malformed
    front matter counts as none, as Claude Code does);
  - `frontMatter(text)`: a small reader for `key: value` lines and `|`/`>`
    block scalars, enough for `name`, `description`, `when_to_use`, and
    `disable-model-invocation`;
  - `indexText(entries)`: one `name: description` line per entry, with the
    description and `when_to_use` cut at 1,536 characters;
  - `memorySlice(text)`: the first 200 lines, at most 25,600 bytes;
  - `xrayReport(sources)`, which builds a `ContextXray`.
- **The Node walk in `cli/xray.ts`,** in order:
  1. **The managed policy file:** `/Library/Application
     Support/ClaudeCode/CLAUDE.md` on macOS, `/etc/claude-code/CLAUDE.md` on
     Linux and WSL, `C:\Program Files\ClaudeCode\CLAUDE.md` on Windows.
  2. **The user's files:** `~/.claude/CLAUDE.md`, then `~/.claude/rules/**`
     files that load at start.
  3. **The folder walk:** for each folder from `/` down to the target,
     `CLAUDE.md`, then `.claude/CLAUDE.md`, then `CLAUDE.local.md`. When the
     whole walk has none of these, `AGENTS.md` and `.claude/AGENTS.md` on
     the walk are used instead.
  4. **The folder's rules:** its `.claude/rules/**` files that load at
     start.
  5. **Imports:** each file's imports, depth-first, after it, up to four
     hops. A file is listed once. A missing import is reported.
  6. **Auto memory:** `~/.claude/projects/<dir>/memory/MEMORY.md`, sliced.
  7. **The skill index:** from `~/.claude/skills/*/SKILL.md` and each
     `.claude/skills/*/SKILL.md` from the folder up to the repository root
     (the nearest folder holding `.git`).
  8. **The subagent index:** from `~/.claude/agents/*.md` and each
     `.claude/agents/*.md` on the same walk.
- **Pages:** each source's `rowsUsed / 60` on the A4 Terminal page, rounded
  to two decimals for display. The tokens come from the analysis's estimate.
- **Output:** text lines read kind, rows, pages, verdict, `~/…` path, and
  "imported by …". Then the total ("Before its first turn, Claude Code loads
  6.25 pages, ≈ 6,100 tokens, from 9 files"), and then the footnote on what
  isn't counted.
- **`proto/a4/v1/xray.proto`:** `ContextXray { agent, folder, sources,
  total_pages, total_tokens, budget_pages, over_budget, not_counted }`, and
  `XraySource { kind, path, imported_by, rows_used, pages, tokens, report,
  unreadable, missing, entries }`. `XraySourceKind` is MANAGED, USER,
  PROJECT, LOCAL, AGENTS, RULE, IMPORT, AUTO_MEMORY, SKILLS, or SUBAGENTS.
- **Where the docs are silent:**
  - **The walk's end:** the docs say "every directory above", so the walk
    goes to `/`.
  - **`./CLAUDE.md` and `./.claude/CLAUDE.md`:** both are counted when both
    exist, the conservative choice for a budget.
  - **The project directory's name:** the observed encoding, the repository
    root's absolute path with every character other than a letter or digit
    replaced by `-` (for example `-Volumes-Workspace-mattmarshall-a4`).
    `CLAUDE_CODE_PROJECT_DIR_NAME` is honored when set. A missing
    `MEMORY.md` simply isn't listed.
  - **HTML comments:** Claude Code strips block-level HTML comments before
    loading. The X-ray measures files as written and may overcount them;
    the footnote says so.
- **Alternative: read Claude Code's settings and plugins.** Deferred. The
  settings layering and plugin install layout are internal, and the X-ray's
  promise is to count readable files and name the rest.

### 9. The command line grows by modules

`cli/a4.ts` becomes a dispatcher of about 100 lines. Usage, `parse`, and
exit codes stay there. The commands move to `cli/lint.ts`,
`cli/letters.ts`, `cli/stacks.ts`, `cli/xray.ts`, and the existing
`cli/mailroom.ts`. The `cli-through-index` exceptions gain
`lib/desk/stacks.ts` and `lib/desk/xray.ts` when they aren't re-exported
from the desk index. `stacks.ts` is re-exported, because the app's folder
index needs it; `xray.ts` isn't.

### 10. First-load size

Stacks add `stack.proto`'s generated code and `lib/desk/stacks.ts` to the
folder index, which the app loads at start (as it does letters). The X-ray
and the mailroom stay out. `check:bundle` has no size limit, so the task
records the first-load figure before and after (14 chunks, 761 KiB today)
and keeps the growth under 20 KiB.

## Risks / Trade-offs

- **[Removing `PAPER_W`/`PAPER_H` touches the renderer broadly]** → The type
  checker finds every use. The A4 hinges stay at 99 and 198, and the
  existing isometry, picking, and paint tests must pass unchanged on A4
  before they're extended to A5 and A6.
- **[A rename silently changes a page's size]** → The sheet shows the size
  with its grid, and lint reports the size. The rule is the label on the
  paper, and it's easy to see.
- **[Claude Code's loading rules change]** → The X-ray names its agent
  (`claude-code`) and lists what it doesn't count. Its rules live in one
  function each, with fixtures as tests. The design records the docs' date.
- **[The X-ray reads the user's home folder]** → It reads only, on the
  device, and prints paths and numbers, never text. That's the same promise
  as `a4 lint`.
- **[Repeated-line detection finds boilerplate]** → The 20-character floor
  skips rules, headings, and short labels, and the finding is a warning,
  not a failure.
- **[Fractional page counts confuse]** → Quarter-page arithmetic is exact,
  and the text says "1.75 of 3 pages".

## Migration Plan

- **Records:** sheet records without a paper size read as A4, and `PageSpec`
  and the lint and letter protos gain fields only.
- **Files:** existing pages, letters, and context files keep their names,
  and so stay A4.
- **Rolling back:** removing the sizes needs renaming any `.a5`/`.a6` pages
  to be judged as A4. The stack folders are inert without the feature.

## Open Questions

- **Should the mailroom offer `read_stack`?** It waits for real use of
  `a4 stack` in session-start hooks, and it doesn't change these specs.
