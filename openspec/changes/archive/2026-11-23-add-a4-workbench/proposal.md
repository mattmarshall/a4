# Proposal

## Why

Agent context windows are now large enough that nothing pushes back on bloat:
engineers paste whole JSON payloads, logs, and schemas, and because tokens are
invisible, so is the waste. Engineers do have a strong, shared intuition for
one physical thing: a page of paper. A page can be seen at a glance, it has a
hard edge, and everyone knows what a busy page looks like.

A4 turns that intuition into a tool. It quantizes one A4 sheet into a fixed
grid of monospace cells (80 x 60 = 4,800 cells, roughly 1,000 tokens), lets the
engineer write agent context directly onto the sheet, and makes the cost and
character of that context visible: how much of the page it fills, how much of
the ink is syntax rather than meaning, how much repeats, and whether it reads
as narrative or as fragments. The goal is a feedback loop for context quality,
the way linters give one for code.

## What Changes

- Add the A4 page model: an A4 sheet quantized into a monospace character grid,
  with the 80 x 60 "Terminal" page as the canonical preset plus typewriter
  presets (Pica, Elite) and a dense preset.
- Add a sheet editor that lets the user type directly on a true-proportion A4
  sheet with rulers, character-exact wrapping at the right margin, and visible
  overflow when text runs past the last row.
- Add density analysis: fill, overflow, ink coverage, crowding, syntax overhead,
  repetition, indentation waste, narrative share, and an estimated token count,
  rolled up into a verdict with specific, actionable findings.
- Add visual lenses that recolor the sheet to show syntax, repetition, line
  structure, and estimated token boundaries, plus a per-row ink gauge in the
  margin.
- Add a compare mode that puts two pages side by side with metric deltas, so an
  engineer can pick the representation that carries more meaning per cell.
- Add narrative templates (situation brief, entity card, handoff, decision
  record, agent charter) and a worked JSON-versus-narrative sample.
- Add export: copy, download as text, and print at true A4 size; autosave the
  working pages in the browser.
- Add a "Why A4" page that explains the problem, the approach, and the practice
  of writing narrative context for agents.
- Configure production hosting as a Cloudflare Worker at https://a4.marsh.build.

Out of scope for this change: accounts, server-side storage, sharing links,
exact model-specific tokenizers, multi-page "ream" documents, AI rewriting of
pages, and collaborative editing.

## Capabilities

### New Capabilities

- `page-grid`: The quantized A4 page model: paper size, presets, cell geometry,
  capacity in cells and estimated tokens.
- `sheet-editor`: Writing directly on the sheet: input, wrapping, rulers,
  overflow display, and autosave.
- `density-analysis`: Metrics computed from page text, the verdict, and the
  findings that tell the author what to change.
- `visual-lenses`: Overlays that recolor the sheet to expose syntax, repetition,
  line structure, and token boundaries.
- `page-comparison`: Side-by-side comparison of two pages with metric deltas.
- `narrative-guidance`: Starter templates, worked samples, and the "Why A4"
  explainer that teach the practice of narrative agent context.
- `page-export`: Copy, download, and true-size print of a page.
- `hosting`: Where and how the application is served in production.

### Modified Capabilities

None. This is the first change in the repository.

## Impact

- New vinext (Next.js App Router API on Vite) application targeting Cloudflare
  Workers, with `cf` deploy configuration for the `a4.marsh.build` custom domain.
- New client-side analysis modules with unit tests run by Node's built-in test
  runner; no runtime services, databases, or secrets.
- Page text stays in the browser (local storage); nothing is sent to a server.
