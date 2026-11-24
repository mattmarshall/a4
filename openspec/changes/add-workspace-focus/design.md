# Design

## Context

- **The top bar** (`components/Workbench.tsx`) holds 22 controls in one
  flex-wrapping toolbar. A separate docbar row shows the page name and save
  status in Single view.
- **The 3D sliders** (`SheetControls`) render as a full-width bar above the
  sheets.
- **The sidebar** stacks `MetricsPanel` or `ComparePanel` and `ModelsPanel`,
  each built from `.panel-section` blocks.
- **The 3D stage height** is a CSS guess
  (`max(420px, calc(100dvh - 230px))`), and Fit zoom considers only the
  desk's width.
- See `proposal.md` for motivation and `specs/workspace-layout/spec.md` for
  the required behavior.

## Goals / Non-Goals

**Goals:**
- At 1440 × 900, the page area starts within 70 px of the top, and the whole
  page is visible.
- Every existing control stays reachable, most in one click.
- No changes to the `<a4-sheet>` element or the analysis.

**Non-Goals:**
- A new visual style, or new controls.
- A command palette, or shortcuts beyond F and Esc.

## Decisions

### 1. One menu component for Page, View, and Help

The existing New ▾ menu (button, popover, outside-click and Esc to close)
becomes a small `Menu` component reused three times.

- **View** holds the rarely changed settings as radio groups: preset,
  rendering, and zoom (Fit or 1:1). It also holds toggles: Cells, Pose &
  camera, and Focus.
- **Page** merges New ▾ with Copy, Download, Print, and Clear.

A single overflow menu was rejected, because named menus are easier to find.

### 2. The page name and status join the top bar

The docbar's name field and save pill move into the top bar for the active
sheet (A in Single view, the active slot in Compare). The Compare captions
keep their per-sheet pickers and status.

Below 1,360 px, a compact style keeps the row whole down to 1,100 px. It
tightens gaps and button padding, narrows the name field, and hides the
Pages label and the save status text visually. Both stay in the accessible
name, and the save status keeps its colored dot and a tooltip.

### 3. Floating pose panel and desk tools

- **Desk tools:** a small button group floats at the desk's top left. In
  3D it shows **Fold ▶** and **Pose…**; in Flat it is hidden.
- **The pose panel:** `SheetControls` renders inside an absolutely
  positioned, dismissible panel below those buttons. It is part of the
  desk, so opening it never moves the page. Esc closes it.

### 4. The lens legend as a desk chip

`LensLegend` renders in a chip at the desk's bottom left when the lens isn't
Ink, or when a model lens is on, and the inspector's Lens section is
removed. The chip is `pointer-events: none` except for its own content, so
it never blocks the desk's drag-to-orbit.

### 5. Collapsible inspector sections, remembered

- **An `InspectorSection` component** renders the title as a button, with
  `aria-expanded` and a chevron. Each section's open state is stored as a
  scalar key, `inspector:<id>`, through `readKey` and `writeKey` (no
  structured records).
- **Defaults:** Verdict, page, and findings start open; shape, repeated,
  and models start closed.
- **Model lenses:** choosing one writes `inspector:models = 1` and opens
  the section.
- **Compare:** `ComparePanel`'s sections use the same component, with their
  own ids.

### 6. Hiding the inspector, and the narrow drawer

- **The toggle:** `KEYS.inspector` stores "1" or "0". When the inspector is
  hidden, the grid drops its column, and a verdict chip appears in the top
  bar.
- **Narrow windows:** below 1,100 px, CSS makes the inspector a fixed drawer
  from the right (with a shadow and a close button), and its default is
  hidden when there's no stored choice. This mirrors how the library
  already defaults to hidden on narrow windows.

### 7. Focus mode

- **State:** a `focus` flag, not persisted.
  `.app[data-focus]` hides the top bar, the library, and the inspector, and
  the desk fills the window.
- **The F key:** it toggles focus only when `document.activeElement` is the
  body, or isn't an input, textarea, select, contenteditable, or `a4-sheet`.
  Typing on the page is never intercepted.
- **Leaving:** Esc leaves focus mode (after closing any open menu or the
  pose panel). An "Exit focus" pill fades in when the pointer nears the top
  edge.

### 8. The page fits the desk

The existing `ResizeObserver` on the desk now records its height as well as
its width.

- **3D:** the stage height is the desk's height, minus padding and, in
  Compare, the caption row. It is passed as `--a4-3d-height` in pixels, so
  the camera's fit keeps the whole sheet visible.
- **Flat Fit:** `min(widthFit, heightFit)`, where
  `heightFit = (deskHeight − chrome) / 297`, still capped at actual size.
- **Layout:** the app becomes a full-height column (`100dvh`), so the desk
  takes all remaining space and scrolls only when the zoom asks for more.

## Risks / Trade-offs

- **[Hidden controls are harder to find]** → Menus are named for what they
  hold, the View menu shows each setting's current value, and the README
  lists where everything went.
- **[F conflicts with typing]** → It is only handled when no editable element
  has focus. A scenario in the spec covers typing F on the page.
- **[Remembered collapsed sections hide new findings]** → The Findings
  section's title shows a count badge even while collapsed.
- **[Print layout depends on the old chrome classes]** → The print CSS hides
  the new top bar, menus, desk tools, chip, and drawer too. Verify by
  printing to PDF.
