# Design

## Context

Greenfield repository. See proposal.md for motivation and specs/ for required
behavior. Constraints that shape the approach:

- The product is one interactive page plus a static explainer. There is no
  server-side state; everything the user writes stays in the browser.
- The grid must be character-exact: the on-screen wrap point, the row counter
  that drives the metrics, and the printed page must all agree.
- Production runs on Cloudflare Workers at a4.marsh.build.

## Goals / Non-Goals

**Goals:**

- Pixel-faithful A4 sheet whose geometry is defined once, in millimeters, and
  reused for screen, metrics, and print.
- Native-quality text editing (selection, undo, IME, paste) on the sheet.
- Analysis that is pure, synchronous where possible, and unit-tested.

**Non-Goals:**

- Exact, model-specific token counts.
- Rich text. A page is plain text; markup is just characters that cost cells.
- Correct cell layout for double-width characters (CJK, emoji); see Risks.

## Decisions

### Framework: vinext on Cloudflare Workers

The app uses the Next.js App Router API through vinext (Vite), deployed as a
Worker with the `cf` CLI. This is Cloudflare's current default for new Next.js
projects, gives Vite's dev loop, and builds straight to a Worker. The app uses
only basic App Router features (layouts, a client component, static routes,
`next/font/google`), so vinext's partial Next.js parity is low-risk here.

Alternative: Next.js with OpenNext. It's more mature, with a heavier build and no
benefit for a mostly client-side app. It's the fallback if vinext blocks us.

### Geometry in millimeters, scaled by one variable

`PageSpec` holds paper size, cell width/height, and margins in millimeters.
Columns and rows are derived (`floor(printable / cell)`), and the grid is
centered in the printable area. The sheet's CSS multiplies every dimension by
one custom property, `--mm` (CSS pixels per millimeter). Zoom changes `--mm`;
print sets it to `1mm`. Font size is `cellWidth / 0.6`, because the typeface's
advance is exactly 0.6 em, and line height is `cellHeight`.

Alternative: size from the font (`ch` units) and derive the paper. Rejected
because print must be millimeter-exact and presets are defined physically
(characters per inch, lines per inch).

### Typeface: IBM Plex Mono

Its advance width is 600/1000 em, so a cell is exactly `0.6 x font-size` with
no runtime measurement. It also has a typewriter-adjacent look that suits a
page metaphor. Loaded with `next/font/google`. Kerning and ligatures are
disabled so every glyph stays on the grid.

### Editing: transparent textarea over a mirrored backdrop

A `<textarea>` sits exactly on the grid with transparent text and a visible
caret. Behind it, a backdrop `<div>` renders the same text, with the same font
and wrapping CSS, as colored spans for the active lens. The browser wraps both
layers identically, so lens colors line up with the caret and selection.

Character wrap uses `white-space: break-spaces` plus `line-break: anywhere` (and
`word-break: break-all`). Together these let a break happen before any character,
punctuation included, and keep spaces from hanging past the margin. The
logical model (`ceil(len / cols)` rows per line) then matches the rendering.
Both layers are half a cell wider than `cols x cellWidth`. That leaves room for
floating-point drift, which would otherwise wrap at column 79, but not for an
81st character.

Alternatives: `contenteditable` loses reliable plain-text undo and paste
handling, and a canvas editor would mean reimplementing selection and IME. Both
are rejected.

The textarea's height is set from the computed row count, so it never scrolls
internally. The page itself scrolls. Rows past the page limit fall below the
sheet's bottom edge onto a hatched overflow zone. The ruler, row numbers, gauge,
and grid are separate absolutely positioned layers in the margins.

### Analysis as a pure module

`lib/analyze.ts` turns text and a `PageSpec` into a metrics object, a verdict,
and findings. `lib/tokens.ts` holds the token heuristic, and `lib/lenses.ts`
turns text into styled segments. All of these are pure and dependency-free. They
are tested with Node's built-in test runner, which runs TypeScript directly, so
no test framework is needed. Compressibility, the one async metric, uses the
browser's `CompressionStream("deflate-raw")` and is computed in an effect.

### Token estimate: heuristic, not a tokenizer

The estimate counts pieces as follows:

- Letter runs: 1 token up to 7 characters, then `ceil(len / 5)`.
- Digit runs: `ceil(len / 3)`.
- Each syntax or punctuation character: 1 token.
- Indentation runs: `ceil((len - 1) / 4)`.
- Line breaks: 1 token each.

The result lands within roughly 20% of BPE tokenizers on prose, JSON, and code,
which is enough to compare two representations. Bundling a BPE vocabulary
(megabytes) for false precision is rejected. Model-specific counts are a
deferred option.

### Persistence: scalar browser storage

Page A text, page B text, preset id, lens id, and the grid toggle are stored
under separate `localStorage` keys as plain strings. No structured record
crosses a boundary, so the project's protobuf-by-default rule is not
triggered. Every access is wrapped so blocked storage degrades to in-memory
state.

### Deployment

`cloudflare.config.ts` declares the Worker `a4` with `domains: ["a4.marsh.build"]`.
On deploy, `cf` creates the custom-domain DNS record and certificate in the
`marsh.build` zone. `pnpm run deploy` builds with Vite and deploys with
`vinext-cloudflare`. The routes are prerendered, and the Worker serves them
through vinext's fetch handler.

## Risks / Trade-offs

- [Browser wrap differs from the row model] → Combine `line-break: anywhere`,
  `break-spaces`, and half-cell slack, and verify in Chromium and WebKit. The
  gauge and overflow use the model, so any mismatch shows up as visible
  misalignment instead of silently wrong numbers.
- [Double-width characters break the grid] → Metrics count code points. The
  limitation is documented, and a future change can flag wide characters.
- [Fallback font before IBM Plex Mono loads] → Both layers share the fallback, so
  they stay aligned, and the grid reflows once the web font arrives.
- [The heuristic token count misleads] → Always label it "≈" and frame it as
  relative. Verdicts use cell-based metrics, never token counts.
- [vinext is younger than Next.js] → The app avoids advanced Next.js features,
  and OpenNext is the fallback.
- [Thresholds are opinions] → They are centralized constants, calibrated against
  the bundled samples. The specs pin them so changes are deliberate.

## Migration Plan

There is nothing to migrate. First deploy:

1. Authenticate the `cf`/Wrangler CLI with the account that owns `marsh.build`.
2. Run `pnpm run deploy`, which also attaches the custom domain.
3. To roll back, redeploy a previous Worker version from the dashboard or CLI.

## Open Questions

- Should a later change add optional model-specific tokenizers, loaded on
  demand, for teams that want exact counts? Deferred. The specs only require an
  estimate.
