# Proposal

## Why

The 3D sheet is the most distinctive way to see a page of context, but it lives
in a separate view mode, and only page A can enter it. The flat sheet and the 3D
sheet are separate React components with duplicated rendering paths. Making the
sheet a self-contained, framework-independent `<a4-sheet>` custom element does
three things:

- Makes 3D the normal way to see every page.
- Gives the flat rendering and the 3D rendering one implementation.
- Lets the sheet ship on its own, so any page can embed an editable A4 page of
  context.

## What Changes

- Add `<a4-sheet>`, an autonomous custom element with a shadow root that holds
  everything a sheet needs:
  - the WebGPU renderer
  - the page painter
  - an encapsulated textarea for typing, selection, undo, and input methods
  - click-to-caret mapping
  - a flat rendering
  - a print layer

  It is configured through attributes (`preset`, `lens`, `render`,
  `fold-bottom`, `fold-top`, `curl`, `tilt`, `turn`, `light`, `zoom`, `grid`),
  read and written through a `value` property, and reports changes through
  standard `input` events plus a few `a4-*` events.
- Make 3D the default rendering of every sheet. Single shows one `<a4-sheet>`
  and Compare shows two side by side. The separate 3D mode goes away.
- Keep a **Flat** rendering as an explicit choice, and switch to it
  automatically, with a notice, when WebGPU is unavailable.
- Paint flat sheets with the same page painter as the 3D texture, with a
  transparent textarea overlaid exactly on the grid. The painter gains overflow
  rows and the cell grid for flat rendering.
- Move the fold and camera controls to a workbench panel:
  - Fold and curl apply to the active sheet.
  - Tilt, turn, light, and zoom apply to every sheet.
  - In 3D, zoom sets the camera distance, and 1:1 is true size at zero tilt.
- Fix printing, which today prints nothing in the 3D view. Every sheet prints
  as true-size text from a print layer inside the element.
- **BREAKING (internal):** the React `Sheet` and `PaperView` components are
  replaced by `<a4-sheet>`, and the stored view mode `paper` migrates to
  `single`.

Out of scope:

- Publishing the element as an npm package.
- Form association (`ElementInternals`).
- A shared multi-sheet desk element.

## Capabilities

### New Capabilities

- `a4-sheet-element`: The `<a4-sheet>` custom element's public contract:
  attributes, properties, methods, events, encapsulation, rendering modes,
  fallback, and print.

### Modified Capabilities

- `paper-view`: 3D becomes the default rendering of every sheet; WebGPU being
  unavailable switches to flat rendering; Fold applies to the active sheet;
  switching renderings keeps text and caret.
- `page-comparison`: Compare shows the two pages as two sheets side by side in
  the current rendering.
- `sheet-editor`: Overflow and zoom are defined for both renderings.

## Impact

- New `lib/element/` modules: the custom element, its styles, and the print
  layer.
- `lib/paper/` gains a shared WebGPU device, overflow and cell-grid painting,
  and a camera zoom.
- `components/Sheet.tsx` and `components/PaperView.tsx` are removed. A thin
  React wrapper (`components/A4Sheet.tsx`) and a `SheetControls` panel replace
  them.
- No new dependencies.
