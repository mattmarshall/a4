# A4: one page of context

A4 is a drafting table for agent context. It quantizes one A4 sheet into a
grid of monospace cells, lets an engineer write the context they plan to give
an agent directly onto that sheet, and shows whether the result is an
efficient representation or a busy one.

The in-app explainer at `/why` presents the same material.

## The problem

**One sentence:** engineers have no visible, intuitive unit for agent context,
so context grows until it is expensive, diluted, and impossible to review.

1. **Abundance removed the pressure to be concise.** Context windows hold
   hundreds of thousands of tokens, so nothing pushes back when we paste a
   whole JSON payload, a log, or a schema "just in case."
2. **Tokens are invisible.** Nobody has an intuition for "1,200 tokens." The
   cost, and the dilution, never shows up where the context is written.
3. **Structured dumps feel rigorous but are mostly scaffolding.** Quotes,
   braces, repeated keys, and indentation cost cells and attention. They also
   leave out what an agent most needs: why the values are what they are, and
   what to do about them.
4. **Context quality has no feedback loop.** We lint code and review diffs,
   but the context that steers an agent is rarely measured or reviewed. At
   40,000 tokens, it can't be.

The consequences are familiar. Agents miss the one fact that mattered among
the many that did not. Behavior drifts as context grows. Latency and cost
climb, and humans stop reading what their agents are told.

## How A4 addresses it

### A page as the unit

The canonical page is A4 (210 × 297 mm), quantized into **80 columns × 60
rows = 4,800 cells**. Each cell is 2.225 × 4.45 mm, which renders as roughly
10.5 pt monospace on 12.6 pt leading, inside 15–16 mm margins. One character
fills exactly one cell, so the area you see is the quantity you spend. A full
page holds at most about 1,200 tokens, and a well-written page of prose holds
about 1,000.

- **A4**, because almost everyone has held one and knows what a crowded one
  looks like.
- **80 columns**, because terminals, punch cards, and most style guides
  already think in 80. Code and logs land on the grid naturally.
- **Monospace**, because it makes the page countable: area is cost.

Other presets (Pica 62 × 58, Elite 75 × 58, Dense 100 × 80) exist for
comparison. The Terminal page is the standard.

### Constraint as an instrument

A fixed edge turns a vague goal ("be concise") into a concrete one ("make it
fit"). This is the same move as the one-page memo, the index card, and the
80-column punch card. When text runs past row 60, it visibly falls off the
sheet into a red overflow zone.

### Make the invisible visible

- **Margin gauge:** a bar per row in the right margin showing how much ink
  that row carries.
- **Lenses** recolor the sheet without changing the text:
  - **Syntax** shows scaffolding characters in red and dims the words.
  - **Repetition** heats terms by how often they are restated.
  - **Structure** tints each line as prose, fields and fragments, or heading.
  - **Tokens** alternates shades across estimated token boundaries.

### Measure it

| Metric | Definition | Signal |
| --- | --- | --- |
| Fill / overflow | Rows used through the last inked row, over the page's rows | Does it fit? |
| Coverage | Ink cells over page capacity | How much of the budget is spent |
| Crowding | Ink over cells in used rows | Wall of text? (Busy at 65% or more) |
| Syntax overhead | Non-word, non-sentence-punctuation characters over ink | Scaffolding (Noisy at 20% or more) |
| Repetition | Term characters spent on repeats | Restating keys and values (Noisy at 40% or more) |
| Duplicate lines | Identical lines containing letters or digits | Copy-paste structure (Noisy at 3 or more) |
| Indentation | Leading whitespace over cells in used rows | Nesting pyramids (Busy at 12% or more) |
| Narrative share | Sentence lines over sentence plus field lines | What versus why (warns below 40%) |
| Tokens ≈ | On-device heuristic, labeled as an estimate | Relative cost |
| Compressibility | Deflated size over raw size | Redundancy |

The metrics roll up into a single verdict: **Empty**, **Overflowing**,
**Noisy**, **Light**, **Busy**, or **Balanced**. Each verdict comes with
findings that say what to change.

### Compare it

Compare mode puts two pages side by side and marks the better value for each
metric. The core workflow is to paste the raw data into A, write the narrative
in B, and keep B once it carries the same facts in fewer, cleaner cells.

### What A4 is not

A4 is not a tokenizer, a prompt optimizer, or an AI rewriter. It is a drafting
table. The thinking stays with the author; A4 makes the cost and shape of that
thinking visible.

## Narrative data for agents

**Narrative data** is context written as connected explanation: what is true,
why it is true, how the parts relate, and what should happen next. Records give
an agent values. Narrative gives it the relationships and intent it needs to
act well in cases the author did not anticipate.

### Why narrative suits agents

- Language models learned to reason from explanatory prose. Sentences are
  their native format for cause, priority, and exception.
- Words like "because," "so," "unless," and "first" carry the logic that a
  record leaves implicit.
- Shared values are stated once instead of repeated in every record.
- A person can review a page in two minutes. Nobody reviews 40,000 tokens of
  JSON.

### When structure is still right

Use a table when the agent needs to look values up: many rows with the same
columns. Keep identifiers, numbers, timestamps, and code exact. The rule of
thumb is **tables for lookup, narrative for understanding**. A good page is
often narrative with one small table.

### The A4 method

1. **One page, one purpose.** The first lines state who the page is for and
   what they will do with it.
2. **Situation first, next action last.** The agent should know where it
   stands and what to do.
3. **Connect the facts.** Write "X happened because Y, so Z," not three
   fields.
4. **State shared values once,** then list only the exceptions.
5. **Keep exact values exact.** Narrative is not vague. Keep the IDs, numbers,
   and times.
6. **Flat over nested.** Express relationships in words, not in indentation.
7. **Cut what doesn't change behavior.** For each sentence, ask whether the
   agent would act differently without it.
8. **Split by purpose, not by length.** When a page overflows, the fix is
   usually two pages with two purposes, such as a charter, a situation brief,
   and an entity card. The agent gets the stack.
9. **Compare before you ship.** Make sure the narrative version keeps every
   fact while lowering syntax, repetition, and tokens.

### Page types

| Template | Use it when |
| --- | --- |
| Situation Brief | An agent is about to act on something live: an incident, a migration, a customer issue |
| Entity Card | An agent must reason about a person, system, customer, or thing, not just look it up |
| Handoff | Work moves between agents, sessions, or people |
| Decision Record | An agent must apply a past decision's judgment to new cases |
| Agent Charter | Defining an agent's standing context (a one-page system prompt) |

### Worked example

The bundled incident sample states the same facts twice.

| | JSON (`jq .` output) | Narrative page |
| --- | --- | --- |
| Rows | 115 (55 over the page) | 31 |
| Tokens ≈ | 1,015 | 410 |
| Syntax overhead | 24% | 1% |
| Repetition | 44% | 30% |
| Narrative share | 4% | 100% |
| Verdict | Overflowing | Balanced |

The narrative is not just shorter. It also says what the JSON cannot: the
cold cache *caused* the database overload, which *caused* the latency.
Confidence is medium *because* logs are missing. Of the four action items, AI-1
is the one that matters, *because* it alone prevents a repeat.

## Where A4 fits in a workflow

- **System prompts and agent charters:** keep standing context to one page.
- **Handoffs between agent sessions:** have long-running agents compact into
  a page, not into a log.
- **Context files in review:** budget files like `AGENTS.md` or prompt
  templates at "fits on one A4" and review them like code.
- **Tool output design:** shape what a tool returns to an agent so a typical
  response fits a page.
- **Teaching:** a before-and-after compare shows narrative context faster
  than any style guide.

## Possible next steps

- **Reams:** multi-page stacks with a page budget and a table of contents.
  The library already stores pages under `a4/pages/`, so a ream could become a
  sibling folder (`a4/reams/<name>/`) without migrating existing pages.
- **Page lint:** a CLI that runs the same analysis over context files in CI.
- **Exact token counts:** optional, model-specific tokenizers loaded on
  demand.
- **More storage backends:** a user-chosen folder (File System Access API)
  or a server. Either would implement the `PageStore` contract and pass the
  shared contract tests.
- **Share links:** needs a page-format decision first; the project default is
  protobuf.
- **Assisted rewrites:** opt-in suggestions that turn a dump into a narrative
  draft.
- **Wide characters:** correct cell widths for CJK and emoji.
