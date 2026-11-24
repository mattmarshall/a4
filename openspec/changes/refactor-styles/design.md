# Design

## Context

- **Prerequisites:**
  - add-code-guardrails (stylelint).
  - refactor-workspace-controller (component split, `useMediaQuery`).
  - refactor-sheet-element (painter reads `PAINT_THEME`).
- **Today:** Tailwind v4 is loaded only for preflight; no utility classes
  are used. Dark mode overrides chrome tokens only. The paper palette stays
  light on purpose.

## Goals / Non-Goals

**Goals:**
- No visual change, proved by screenshot comparison.
- Each component's styles live beside it.
- One source for colors and breakpoints.

**Non-Goals:**
- Redesign.
- New tokens beyond what the existing values need.

## Decisions

### 1. Layers in one step

- **The order:** `@layer tokens, base, components, layout, print;` is
  declared first in `globals.css`.
- **Why one step:** an unlayered leftover would beat every layer, so the
  move happens in a single commit. A stylelint rule rejects unlayered
  rules in `globals.css`.

### 2. CSS modules per panel

- **The modules:** Vite supports `*.module.css`. Panel classes become module
  classes (`styles.item`).
- **Global primitives:** `.btn`, `.seg`, `.menu*`, and swatches stay global
  in `components`, because they're shared.
- **Print:** it keys on `data-print` attributes, not module classes.

### 3. The palette

- **`palette.ts` exports one object for the paper, ink, rules, lens, and
  heat colors.**
- **CSS gets it at build time:** a tiny Vite plugin emits
  `:root{--a4-paper:…}` from it.
- **The painter and the shadow DOM import the object directly.**
- **The drift test:** it fails if any hex or `rgba` literal for these colors
  appears outside `palette.ts`.

### 4. Screenshot comparison

A CDP script, extending the existing scratch scripts and committed under
`scripts/`, captures fixed views before and after the move, then compares
pixels with a small tolerance:
- workbench Single and Compare;
- light and dark;
- 1440 and 1100 widths, and a 900-wide drawer;
- focus mode;
- every lens;
- print to PDF.

## Risks / Trade-offs

- **[Silent visual regressions]** → Screenshot comparison on the listed
  views, plus a manual pass on menus and dialogs.
- **[CSS module churn in components]** → Done in the same commits that move
  each panel's rules, one panel at a time.

## Migration Plan

Styles only. Reverting is a revert of the commits.

## Implementation Notes

- **The layer order includes Tailwind's layers.** It is
  `@layer theme, tokens, base, components, utilities, layout, print;`.
  Tailwind's `theme` and `utilities` take their places in it, and its
  preflight lands in `base` before ours. Layer order is set where a name
  first appears, and a module's stylesheet can load before `globals.css`, so
  every module repeats the statement.
- **The palette reaches CSS through a marker, not a virtual module.** The
  `a4Css` plugin in `vite.config.ts` replaces `/* a4:palette */` in
  `globals.css` with `:root { --a4-*: … }`, and fails the build if the marker
  is missing. A virtual CSS module 404'd in vinext dev. The RSC build loads
  side-effect stylesheets as empty text, so the plugin skips empty input.
  The same plugin resolves `@media (--bp-<name>)` from
  `components/breakpoints.ts`. Breakpoints use max-width semantics
  (`width <= 1099px`), matching the old queries exactly.
- **The drift test** (`lib/render/palette.test.ts`) also catches the model
  violet's rgb at any alpha. The violet has two tokens: `--model-ink`, for
  text, stays the palette violet in dark mode. `--model-violet`, for chrome,
  lightens to `#a78bfa` there.
- **Two stylelint rules of our own** (`scripts/stylelint-*.ts`):
  - `a4/require-layer`, every rule inside an `@layer`, in every stylesheet;
  - `a4/known-tokens`, every `var(--x)` without a fallback names a token that
    `globals.css`, the palette, or the file defines.

  `import-notation` is set to `string` for Tailwind's `@import "tailwindcss"`.
  The only disable comment left is for next/font's `--font-plex-*`
  properties.
- **One intended visual change: the top bar's save pill on medium windows.**
  In the old stylesheet, a stray `.topbar ` prefix had split from its rules
  inside the medium media query. Two things followed:
  - The compact `.save-pill { gap: 0; padding: 6px }` lost to the later base
    `.save-pill` rule, so the pill was a lozenge around its dot instead of
    the round dot the README describes.
  - The fit chip's styles only ever matched `.topbar .fit-chip`, at medium
    widths, and the chip never sits in the top bar, so it went unstyled.

  The fixes:
  - `SaveStatusPill` takes `compact`, which sets `data-compact`, and hides
    its label with `.visually-hidden-medium`. The Pages label uses the same
    class.
  - The fit chip is now styled at all widths, as `.fitChip` in
    `ModelsPanel.module.css`.

  Screenshots show about 190 pixels of difference: in Single and Compare at
  1,100 px, and in the inspector drawer at 900 px, both themes. Every other
  view matches pixel for pixel.
- **The cleanup:**
  - `.topbar :where(.btn)` keeps the medium-width button padding from
    outranking more specific button rules.
  - The review's "duplicate verdict rule" was in use: `.verdict` lays out
    the Verdict section, so it moved into the module instead of being
    removed. Every verdict chip (inspector, Compare, top bar) is one
    `VerdictChip` component.
  - `FindingList` is shared by MetricsPanel and ComparePanel.
  - The pose panel's `.sheet-controls` overrides were merged into the base
    rule.
  - The duplicate `.menu-list`/`.menu-item` blocks were merged, and the
    primitives reordered so no selector follows a more specific one, keeping
    which rule wins on hover and press.
- **Removed dead rules:**
  - `.lens-dim`, `.lens-syn`, `.lens-kind-*`, `.tool-label`, and `.brand-tag`;
  - the `--ruler`, `--heat-*`, and `--tok-*` tokens, now palette properties;
  - the overridden `.page-name` and `.zoom-value` sizes.
- **Print** hides by `data-print="hide"` and flattens the layout by
  `data-print="flow"`, in the `print` layer, with no `!important`. Print to
  PDF still gives one page for Single, two for Compare, and five for the
  element demo.
- **Verification:**
  - `scripts/screenshots.ts` captures 33 views. Each gets a fresh browser
    context, with WebGPU off so sheets render flat.
  - The dev server matched the production baseline pixel for pixel, so each
    step was compared in dev. The final production build was compared with
    the baseline captured before the change.
  - A manual pass covered the menus, the Fit to page consent dialog (with a
    fake key, never sent), both drawers, and focus mode, in light and dark.
