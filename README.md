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
- **Privacy**: everything runs in the browser, and nothing is sent to a
  server.

## Pages, storage, and autosave

The library holds any number of pages. You can search, create (blank or from
a template), rename, duplicate, delete to the trash, restore, and delete
permanently. Each page is stored as a Markdown file whose content is exactly
the page text, so a file can be handed to an agent as is.

```
<Origin Private File System>/
  a4/
    pages/<page name>.md    one file per page
    trash/<page name>.<deleted-at>.md
```

- **Typed store** (`lib/store/`): every backend implements the `PageStore`
  contract in `lib/store/types.ts`. That contract covers list, read, create,
  write, rename, trash, restore, and purge. It uses validated `PageName`
  values, content-hash `Revision`s for conflict detection, and typed errors.
  The backends are:
  - `OpfsPageStore`, the default.
  - `KeyValuePageStore` over `localStorage`, used where OPFS writable files
    are unavailable. Its pages move into OPFS once OPFS is available.
  - `MemoryPageStore`.

  A new backend must pass the shared suite in
  `lib/store/testing/contract.ts`.
- **Autosave** (`lib/autosave/`):
  - Every edit is journaled to `localStorage` synchronously, per tab and
    page.
  - The page is saved 600 ms after typing pauses, and at least every 4 s
    while typing continues.
  - Saves also happen on tab hide, page switch, and Ctrl/Cmd+S.
  - Failed saves retry with backoff.
  - If another tab saved first, your text is kept as a "(conflict …)" copy.
  - Drafts left by a crashed or closed tab are recovered on the next load.
- **Cross-tab**: a `BroadcastChannel` tells other tabs to refresh, and an idle
  tab reloads a page another tab saved.
- **Durability**: on the first edit, A4 asks the browser for persistent storage
  (`navigator.storage.persist()`). The library footer shows the active backend
  and whether storage is persistent.
- **Upgrading**: text from the earlier single-page version (`a4:text:a` and
  `a4:text:b`) is imported as pages on first load. The old keys are kept.

## Deploy to a4.marsh.build

The Worker is defined in `cloudflare.config.ts` (name `a4`,
`domains: ["a4.marsh.build"]`). A deploy uploads a new Worker version,
promotes it, and applies the custom domain. That requires the `marsh.build`
zone to be on the deploying Cloudflare account.

### Continuous deployment (GitHub Actions)

`.github/workflows/deploy.yml` runs test, typecheck, and build on every push
and pull request. On pushes to `main` (or a manual run on `main`), it then runs
`pnpm run deploy` and smoke-tests `/`, `/why`, and a 404 on the live site.

The deploy job needs two repository secrets:

- `CLOUDFLARE_ACCOUNT_ID`: the account that owns the `marsh.build` zone.
- `CLOUDFLARE_API_TOKEN`: an API token created in the Cloudflare dashboard
  (My Profile → API Tokens) from the **Edit Cloudflare Workers** template.
  Scope it to that account and the `marsh.build` zone, and add
  **Zone → DNS → Edit** for the custom domain.

```bash
gh secret set CLOUDFLARE_ACCOUNT_ID --repo mattmarshall/a4
```

```bash
gh secret set CLOUDFLARE_API_TOKEN --repo mattmarshall/a4
```

Each command prompts for the value, so it never lands in shell history. If
the secrets are missing, the deploy job fails with a message that says so.
Pull requests never deploy.

### Manual deploy

```bash
pnpm exec cf auth login
```

```bash
pnpm run deploy
```

Use `run`: bare `pnpm deploy` is a built-in pnpm command. To roll back,
redeploy a previous Worker version from the Workers dashboard.

## OpenSpec

Requirements are managed with [OpenSpec](https://github.com/Fission-AI/OpenSpec).
The living specs are in `openspec/specs/`:

- **The page:** `page-grid`, `sheet-editor`, `density-analysis`,
  `visual-lenses`, and `page-comparison`.
- **Guidance and export:** `narrative-guidance` and `page-export`.
- **Pages and storage:** `page-library`, `page-storage`, and `autosave`.
- **Deployment:** `hosting`.

The changes that produced these specs, each with its proposal, design, and
tasks, are archived under `openspec/changes/archive/`:

- `2026-11-23-add-a4-workbench`
- `2026-11-23-add-page-library`

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
