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
