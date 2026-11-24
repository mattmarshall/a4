# Proposal

## Why

The workbench frames the page more than it shows it. Measured at 1440 × 900:
- **Above the page, 283 px (31% of the height) is controls.** The toolbar
  wraps onto two rows (91 px), the page-name row takes 32, and the 3D
  sliders take 104.
- **The 3D page doesn't fit.** It runs past the bottom of the window.
- **The sidebar takes 340 px of width,** and its eight sections scroll
  through about 2.7 screens.
- **22 controls are always visible,** though most are set once or used
  rarely: grid preset, cells, 3D/Flat, fold and camera sliders, export,
  templates, help.

The page and the desk behind it should get the space. Everything else should
be one click away.

## What Changes

- **One slim top bar.**
  - Kept in view: the A4 mark, Pages, the page name and save status, the
    lens choice, Single/Compare, zoom, and an Inspector toggle.
  - Menus hold the rest: **Page** (new page, copy, download, print, clear),
    **View** (grid preset, cell grid, 3D/Flat, Fit and actual size, pose
    and camera, focus mode), and **Help** (Why A4?, the `<a4-sheet>`
    element).
- **The 3D controls leave the layout.** Fold, curl, and camera sliders move
  to a floating panel, opened from View or a button on the desk. A Fold
  button floats on the desk in 3D.
- **The lens legend moves onto the desk** as a chip beside the page, shown
  only when a lens other than Ink is active.
- **The inspector collapses.**
  - Each section can be collapsed, and remembers its state. Verdict, the
    page, and findings start open; shape, most repeated, and models start
    closed.
  - The Models section opens by itself when a model lens is chosen.
  - The whole inspector can be hidden, keeping the verdict in the top bar.
- **Narrow windows:** below 1,100 px wide, the inspector opens as a drawer
  over the desk instead of covering the page.
- **Focus mode** (F, or View → Focus) hides the bars and panels, leaving the
  page on the desk. Esc, or the exit button, brings them back.
- **The page fills the desk.** The 3D stage takes the desk's full height, and
  Fit sizes the flat page to both the width and the height, so the whole
  page is visible without scrolling.

## Capabilities

### New Capabilities
- `workspace-layout`: the top bar and its menus, the floating pose panel,
  the lens legend on the desk, the collapsible inspector, focus mode, and a
  page that fits the desk.

### Modified Capabilities

## Impact

- `components/Workbench.tsx`, `components/MetricsPanel.tsx`,
  `components/ComparePanel.tsx`, `components/ModelsPanel.tsx`,
  `components/SheetControls.tsx`, `app/globals.css`, and README.
- `lib/storage.ts` gains keys for the inspector's state.
- No change to the `<a4-sheet>` element, the analysis, the models, or
  storage of pages.

## Out of scope

- Restyling the page, the paper, or the 3D rendering.
- New analysis or new controls. Every existing control stays reachable,
  most in one click.
- Mobile-first layouts beyond the narrow-window drawer.
- Keyboard shortcuts beyond F and Esc for focus mode.
