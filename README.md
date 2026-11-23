# A4

**One page of context.** A4 quantizes an A4 sheet into a grid of monospace
cells (80 columns × 60 rows = 4,800 cells, roughly 1,000 tokens of prose).
You write the context you plan to hand an AI agent directly on the sheet, and
A4 shows whether it is an efficient representation or a busy one: how much of
the page it fills, how much of the ink is syntax, what repeats, and whether it
reads as narrative or as fragments.

- Production: https://a4.marsh.build
- Concept (problem, approach, and narrative practice): [docs/concept.md](docs/concept.md),
  also served in the app at `/why`
- Requirements: [openspec/](openspec/) (spec-driven, see below)

## Quick start

Requires Node 24+ and pnpm.

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | vinext dev server (Vite, running in workerd) |
| `pnpm test` | Unit tests for the page model and analysis (Node's built-in test runner) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm build` | Production build to `.cloudflare/output`, with `/` and `/why` prerendered |
| `pnpm start` | Serve the production build locally in workerd |
| `pnpm check` | test, typecheck, and build |
| `pnpm run deploy` | Deploy the Worker to Cloudflare (see below). Use `run`: bare `pnpm deploy` is a built-in pnpm command |

## How it works

- **Page model** (`lib/page-spec.ts`): A4 geometry in millimeters. The
  Terminal preset uses 2.225 × 4.45 mm cells centered with 16/15 mm margins.
  Pica, Elite, and Dense presets derive their grids from characters-per-inch
  and lines-per-inch. The screen scales everything by one `--mm` factor, and
  print uses true millimeters.
- **Editor** (`components/Sheet.tsx`): a transparent `<textarea>` over a
  mirrored backdrop that renders the active lens. Both layers use IBM Plex
  Mono (0.6 em advance, so a glyph is exactly one cell), plus
  `white-space: break-spaces` and `line-break: anywhere`. Lines therefore wrap
  after exactly `cols` characters, matching the row model in `lib/text.ts`.
- **Analysis** (`lib/analyze.ts`, `lib/tokens.ts`): pure functions for fill,
  overflow, coverage, crowding, syntax overhead, repetition, duplicate lines,
  indentation, narrative share, estimated tokens, compressibility, the verdict,
  and findings. Thresholds live in `THRESHOLDS` and are pinned by the specs.
- **Lenses** (`lib/lenses.ts`): Ink, Syntax, Repetition, Structure, and
  Tokens. They are presentation only and never change the text.
- **Privacy**: everything runs in the browser. Pages autosave to
  `localStorage` (`a4:*` keys), and nothing is sent to a server.

## Deploy to a4.marsh.build

The Worker is defined in `cloudflare.config.ts` (name `a4`,
`domains: ["a4.marsh.build"]`). Deploying creates the custom-domain DNS
record and certificate. This requires the `marsh.build` zone to be on the
deploying Cloudflare account.

```bash
pnpm exec cf auth login
```

```bash
pnpm run deploy
```

For CI, set `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit, plus Zone DNS: Edit
and Workers Routes: Edit on `marsh.build`) and `CLOUDFLARE_ACCOUNT_ID`
instead of logging in. To roll back, deploy a previous version from the
Workers dashboard.

## OpenSpec

Requirements are managed with [OpenSpec](https://github.com/Fission-AI/OpenSpec).
The living specs are in `openspec/specs/`: `page-grid`, `sheet-editor`,
`density-analysis`, `visual-lenses`, `page-comparison`, `narrative-guidance`,
`page-export`, and `hosting`. The change that introduced them (proposal,
design, and tasks) is archived at
`openspec/changes/archive/2026-11-23-add-a4-workbench/`.

```bash
openspec list --specs
```

```bash
openspec validate --specs --strict
```

Propose new work as a change (`/openspec-propose`), implement it
(`/openspec-apply-change`), then archive it to fold its deltas into
`openspec/specs/`.

## Known limitations

- Token counts are a heuristic estimate, roughly within 20% of BPE tokenizers.
  Use them to compare pages, not to budget exact model limits.
- Double-width characters (CJK, emoji) and glyphs outside IBM Plex Mono's
  Latin sets can break the one-character-per-cell grid.
