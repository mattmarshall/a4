# Proposal

## Why

All of A4's styling lives in one 2,017-line `app/globals.css`. The review
(`docs/tech-debt-review.md` C1–C5, A8) found:
- **Dead rules:** lens classes now painted on canvas, a brand tag with no
  markup, an unused `--ruler`, overridden sizing, and a duplicate verdict
  rule.
- **Fragile order:** a base rule after its own drawer override, two
  definitions each of `.menu-list` and `.menu-item`, and print rules that
  need 12 `!important`s.
- **Selectors that reach into other components.**
- **Values that should be tokens:** 12 font sizes, 10 radii, an uppercase
  label recipe written 10 times, and z-index values from 5 to 50.
- **A palette with three sources:** CSS tokens, painter `rgba` values, and
  shadow-DOM hex values.
- **Breakpoints duplicated** in JavaScript.

Changing one component's look today risks another's.

## What Changes

- **Cascade layers:** `@layer tokens, base, components, layout, print;`.
  - Every app rule moves into a layer in one step, because Tailwind v4
    already emits layers and unlayered rules beat them.
  - Tailwind's preflight is kept.
- **Co-located styles:** each panel's styles move next to it as a CSS
  module (library, metrics, models, compare, inspector, prose pages).
  Shared primitives (button, segmented control, menu, swatches) stay
  global in the components layer.
- **Tokens:**
  - `--text-*` sizes, `--radius-*`, `--z-*`, `--hover`, and an `.eyebrow`
    class for the uppercase labels.
  - A model-violet token with a dark-mode value.
- **One palette:** `lib/render/palette.ts` is the single source for the
  paper, ink, and lens colors. It is written into CSS custom properties at
  build time and read by the painter (refactor-sheet-element), so the three
  copies become one.
- **Breakpoints:** `--bp-medium` (1,360 px) and `--bp-narrow` (1,100 px),
  defined once. JavaScript reads them through `useMediaQuery` (from
  refactor-workspace-controller) with the same values from one TypeScript
  constant, and the CSS uses `@custom-media`.
- **Print** hides chrome by `[data-print="hide"]` in the last layer, with no
  `!important`.
- **Cleanup:** dead rules removed, duplicate definitions merged, and
  cross-component selectors replaced with variant classes or data
  attributes. A `.visually-hidden` utility replaces the label-hiding
  selector.
- **stylelint warnings become errors.**

## Capabilities

### New Capabilities

### Modified Capabilities

(None: the look is unchanged, so `skip_specs` is set.) Layout, themes,
focus mode, drawers, and print stay as specified.

## Impact

- **Global CSS:** `app/globals.css` shrinks to tokens, base, primitives, and
  print.
- **New:** `components/*.module.css`, `lib/render/palette.ts`, and a small
  build step (or a Vite plugin) that writes palette custom properties.
- **Components:** class names updated.
- **Lint config:** `.stylelintrc.json` rules become errors.

## Out of scope

- A visual redesign.
- New themes.
- Replacing Tailwind.
