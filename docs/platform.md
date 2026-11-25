# A4 as a platform: paper for agents

A4 began as a drafting table: one person writes one page of agent context and
sees what it costs. This document proposes the platform underneath that
table: what it offers, the building blocks and patterns it is made of, and
the application that would make people reach for it every day.

It is a proposal. Each step in the roadmap becomes its own OpenSpec change
before anything is built. The problem and the writing practice behind A4 are
in [concept.md](concept.md).

## The platform in one line

**A4 is paper for agents: the standard unit, format, and rules for the
context that people and agents hand each other.**

Paper sizes are an interoperability standard. Because ISO 216 fixed the
sheet, printers, envelopes, folders, and filing cabinets all fit together.
A4 makes the same move for context. It defines one unit (a page of 80 × 60
cells, about 1,000 tokens), one format for that page, and a few rules that
hold wherever the page goes:

- a page has to fit;
- a machine never writes over a person's page;
- nothing leaves the desk unsigned.

Tokens are invisible, and a page is not. No other unit of context can be
seen, counted, and reviewed by a person in two minutes.

### What A4 owns, and what it leaves to others

A4 owns the page: its budget, its judgment, its comparison, and its review.
It doesn't route work, keep accounts, manage identities, or move messages
between machines. Systems that do those things are its natural partners:
an agent harness, a work router, a review queue, or a ledger. A4 gives them
a unit a person can read and a gesture a person can approve with. They give
A4 delivery, identity, and durable records.

## A4 is already most of a platform

| Platform piece | What exists | Where |
| --- | --- | --- |
| A unit | The Terminal page, 80 × 60 cells, about 1,000 tokens, with presets | `lib/page/` |
| A format | `Sheet`, `Grid`, `Plane`, and `Embedding` messages, and a lossless text↔tensor codec | `proto/a4/v1/`, `lib/tensor/` |
| A model contract | `SheetModelService` (Describe, Status, Prepare, Encode, Score, Transform, Generate) and model cards | `proto/a4/v1/model.proto`, `lib/models/` |
| Host rules | The host decides fit, results never overwrite, a consent token is needed for each call that sends text away, and the host holds credentials | `lib/models/` |
| A judge | Metrics, a verdict, and findings, in a core free of DOM and Node | `lib/analysis/` |
| A surface | `<a4-sheet>`, framework-free, 3D or flat, with model planes | `lib/render/element/` |
| Storage | The `PageStore` contract, and folders with faithful saves to context files | `lib/persist/` |
| Forms | Situation Brief, Entity Card, Handoff, Decision Record, Agent Charter | `lib/content/templates.ts` |

What's missing is a way for pages to *move* between sessions, agents, and
people, with a record of who wrote them and who approved them, and outside
the browser.

## Building blocks

The metaphors come from paper and the office, the vocabulary A4 already uses:
page, desk, lens, fold, ream, letter.

| Block | What it is | Today |
| --- | --- | --- |
| **Sheet** | The atom: one page of context. The text is the source of truth, and the grid is derived from it. | Built |
| **Stationery** | Preprinted forms: page types with a stated purpose and the sections they need | The templates; checking required sections is new |
| **Tracing paper** | An overlay laid on a sheet: one value per cell from any model. It reads and never writes. | Model planes and lenses |
| **Pen** | A model that writes a new sheet. The desk, not the pen, lays it out. | Fit to page |
| **Red pen** | The editor's marks: the verdict and findings, about form | The analysis |
| **Desk** | Where sheets are laid out, compared, judged, and signed. It holds the keys. | The workbench and the model host; a headless desk is new |
| **Drawers** | Where sheets are kept | The library and folders |
| **Stack** | An ordered set of pages with a page budget: an agent's whole context window | Built: stacks in `.agents/stacks/`, and the context X-ray |
| **Letter** | A sheet that's folded, sealed, and addressed. Its text is frozen once it's sealed. | The 3D letter fold exists as a gesture |
| **Seal** | A person's acceptance of a letter | Consent for outgoing calls exists; sealing letters is new |
| **Postmark** | The record on a sealed sheet: content digest, author, model, time, and the letter it follows | New |
| **Post** | Delivery between desks: sessions, agents, tools, and people | New |

## Patterns

1. **One page, one purpose.** The desk decides whether a page fits, never
   the writer. When a page overflows, split it by purpose into a stack
   rather than squeezing it. *(The host already decides fit for models.)*
2. **Carbon copy.** A machine never writes over a person's page. Its output
   lands beside the original as a new sheet. *(Built.)*
3. **Tracing paper.** Reading and writing are separate powers. Any number of
   models can lay overlays on a sheet; only pens make new sheets. *(Built:
   Score and Transform.)*
4. **The fold ladder.** A-series paper halves when folded and keeps its
   shape: A4, A5, A6. Compaction can work the same way:
   - a session folds into an A4 letter (about 1,000 tokens);
   - the letter folds into an A5 card for an index (about 500);
   - the card folds into an A6 postcard for a notification (about 250).

   Each fold halves the budget, and each result is a page a person can read.
   *(Built: A5 and A6 page sizes, judged everywhere a page is.)*
5. **Agents write, people seal.** An agent can draft a letter. Only a
   person, at the desk, can seal it, and only sealed letters are delivered.
6. **A seal is acceptance, not truth.** A seal records that a person read a
   letter and accepted it. A4's verdict judges form: fit, noise, narrative.
   Neither one is a claim that the letter is true, or a trust score.
7. **Narrative on the page, structure in the record.** A page never replaces
   a structured record. When a task already has structured fields, they stay
   structured, and the page carries the why and points back to the record.
   This is the rule from concept.md: tables for lookup, narrative for
   understanding.
8. **One page per attention slot.** A person's review time is the scarcest
   resource in an agent system. When a system schedules it, the unit it
   schedules is a page: about two minutes of reading.
9. **Postmark everything.** Every sealed sheet carries a sha256 content
   digest, written as a URN, so a log, a ledger, or a review record can cite
   exactly what an agent was told and who approved it.

## The platform's layers

From the bottom up:

- **Paper**, the format: `a4.v1`, the tensor codec, and the presets. Tools
  read and write it.
- **Pens and tracing paper**, the models: `SheetModelService`. Plugins stay
  bundled for now, which keeps today's privacy rules intact.
- **Desk**, the host and its surfaces: the workbench, `<a4-sheet>`, and a
  headless desk for scripts, CLIs, and agents.
- **Post**, delivery: a local mailroom that agents and outside systems talk
  to.

## The killer app: Letters

**Every agent session ends with a one-page letter. A person reads it in two
minutes, seals it, and the next session starts from it.**

Handoffs and compaction are invisible today. A long session compacts into a
summary nobody reads. The next session starts from a log, and work between
agents passes around transcripts. Concept.md names the result: humans stop
reading what their agents are told. Letters makes reading it the default,
because it is one page.

### The loop

1. **Write.** At the end of a session, or when its context runs low, the
   agent asks the mailroom to file a letter, starting from the Handoff form.
   The headless desk lays it out on the Terminal grid and returns:
   - whether it fits, and by how many rows it's over;
   - the verdict and findings.

   The agent rewrites until the letter fits and reads Balanced. This is the
   loop Fit to page already runs, with the agent as the pen.
2. **File.** The draft lands in the repository's mailroom,
   `.agents/letters/`, as plain Markdown that any agent or editor can read.
   It never replaces an earlier letter.
3. **Review.** You open the folder in A4, and Letters shows as an inbox. Each
   letter opens in Compare against the one before it, with the lenses and
   findings. You can edit it in place.
4. **Seal.** You choose **Fold**. The letter fold, a decoration today, becomes
   the seal:
   - the text is frozen;
   - the postmark is written, with the digest, the signer, the verdict, an
     optional rationale, and the letter it follows;
   - the letter is marked delivered.
5. **Deliver.** When the next session starts, it asks the mailroom for the
   latest letter and gets only a sealed one. A draft never steers an agent.

### With a harness, router, or review queue

Letters works on one machine with no server. It grows when it's connected to
a system that runs agents and schedules people:

- A harness writes the letter at each checkpoint, as the human-readable body
  of its own handoff record.
- A system that allocates reviewers' attention can register the mailroom and
  offer letters for review slots, one page per slot.
- The seal becomes that system's acceptance record, with its rationale. The
  postmark digest is what its logs and ledgers cite.
- The next task receives the accepted letter alongside its structured fields,
  not in place of them.

### Why Letters

- **It's a daily habit.** It happens at every session, not once per project.
- **A4 is the place to do it well.** It needs:
  - fit decided by the desk;
  - narrative analysis;
  - Compare;
  - signed, consented egress;
  - a fold gesture that already exists.
- **It's local and private.** Letters are files in your repository.
- **It works across tools.** Any agent that reads Markdown can read a
  letter.
- **It's a way into the rest of the platform.** Once letters flow through
  A4, the other pieces apply to them too: stacks (a charter, the latest
  letter, and a few entity cards), page lint, overlays, and the fold ladder.

Page lint brings people in, a context X-ray of an agent's window shows what
A4 can do, and Letters is the daily habit.

### How we'll know it works

- Most sessions in a repository end with a sealed letter.
- Letters average under 60 rows and read Balanced.
- A review takes under two minutes.
- A new session needs no "where were we?" turn.

## Roadmap

Each step is its own OpenSpec change, in this order.

1. **`add-headless-desk`, built.** The desk runs outside the browser.
   - **The desk:** `lib/desk/` judges a page (fit, verdict, findings, and the
     `AnalysisReport`) and lints a folder's context files. It imports no DOM
     or Node API, so letters and the mailroom can reuse it.
   - **One fit rule:** `pageFit` in `lib/page/` now decides fit for the sheet,
     the analysis, the folder view, the model host, and lint.
   - **The command:** `a4 lint` checks a repository's context files and exits
     non-zero when one doesn't fit (README, "Page lint"). It uses the Node
     folder adapter that already existed.
   - **Still to come:** the host's attempt loop stays in the model host, and a
     desk-driven loop can follow when letters need one.
2. **`add-letters`, built.** Letters exist (README, "Letters").
   - **On disk:** letters in `.agents/letters/`, with a `.postmark.json`
     sidecar for each seal: an `a4.v1.Postmark` with a sha256 URN digest, an
     RFC 3339 time, accept or return with a reason, the signer, and the
     parent letter.
   - **In the app:** a Letters group in the folder view, Compare against the
     previous letter, New letter from the Handoff form, a seal dialog whose
     Accept plays the fold, and a read-only sheet for sealed letters.
   - **From the command line:** `a4 letters` lists letters, and
     `a4 letters --latest` delivers the newest accepted one, so a plain
     session-start hook works before the mailroom exists. `a4 lint` checks
     letters too.
   - **Left for the mailroom, now built:** a tool that files a letter after
     the desk's fit check, and one that reads letters for an MCP client.
3. **`add-mailroom-mcp`, built.** Agents file and read letters through a
   local MCP server (README, "Mailroom").
   - **The server:** `a4 mailroom [folder]` speaks MCP over stdio, for one
     folder. It makes no network request and has no dependency beyond the
     desk.
   - **Three tools,** annotated so a client or an outside system can tell
     reads from writes:
     - `lint_page` (read-only) is the agent's fit loop;
     - `write_letter` files a new draft, refuses a letter over the page with
       the rows over and the findings, and never writes over a file;
     - `read_letter` (read-only) returns only an accepted letter with its
       seal intact, or by digest, a letter's state.
   - **No tool seals.** Agents write, people seal.
   - **Hooks:**
     - at session start, `a4 letters --latest`;
     - at the end, the server's instructions and a `letter` prompt.
   - **Records:** results carry `a4.v1.PageCheck`, `FiledLetter`, and
     `LetterDelivery` as structured content, so any outside harness or
     review system can register the mailroom as a plain MCP server.
   - **Still to come:**
     - a tool that seals on a person's recorded verdict, if an outside
       review system makes the case for one;
     - showing drafts to a reviewer outside A4.
4. **`add-stacks`, built.** Context counts as paper (README, "Page sizes",
   "Stacks", and "Context X-ray").
   - **The fold ladder:** A5 cards (56 × 42 on Terminal) and A6 postcards
     (40 × 29). A page's size comes from its name (`.a5.md`, `.a6.md`), and
     every surface judges a page on its size: the sheet in 3D and flat,
     print, analysis, lint, letters, the mailroom, and Fit to page. No model
     folds a page.
   - **Stacks:** folders in `.agents/stacks/`, one sheet on one stack, with a
     label giving the purpose and a page budget (A5 counts half, A6 a
     quarter). The desk judges a stack's budget, its pages on their sizes,
     and the lines it says twice. The app lists stacks, `a4 lint` fails one
     over its budget, and `a4 stack <name> --letter` hands a session its
     stack with the latest letter on top.
   - **The context X-ray:** `a4 xray` counts, in pages, what a coding agent
     loads from files before its first turn, says what it can't count, and
     fails CI over a `--budget`.
   - **Still to come:** a mailroom tool that reads stacks, and a model pen
     that folds a page down the ladder.
5. **Later.**
   - Signed third-party pens and overlays.
   - Share links (the page format decision in concept.md).
   - A server-backed desk that passes the store contract tests.

## What A4 still is not

The platform doesn't change what concept.md says A4 is not. It isn't a
tokenizer, a prompt optimizer, or a router. Pens are opt-in, consented, and
never write over a person's page. The thinking stays with the author; A4
makes its cost and shape visible, and now lets it travel.
