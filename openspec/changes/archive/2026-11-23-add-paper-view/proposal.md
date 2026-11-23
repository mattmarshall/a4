# Proposal

## Why

A4's premise is that a page of context should feel like a physical page. Today
the sheet is a flat rectangle. A sheet that can be folded, curled, tilted under
a light, and edited while it is bent makes that premise tangible and gives the
product a memorable identity.

The browser offers no way to run shaders over a DOM element's pixels. Chrome's
HTML-in-Canvas API is an experimental exception, and its hit-testing transform
is one planar matrix, which cannot describe a folded sheet. So the view has to
render the page itself.

## What Changes

- Add a **3D** view mode that renders the open page with WebGPU. The page is
  textured from A4's own page model (cells, rows, lens colors, caret, and
  selection), not captured from the DOM.
- Deform the sheet without stretching it: a letter fold (bottom third up, then
  top third down) with rounded creases, a page curl from the bottom-right
  corner, a camera tilt, and an adjustable light. Shading includes a lit front,
  a plain back, darker creases, and a shadow on the desk.
- Keep editing in 3D. Clicking a character cell on the bent paper places the
  caret there, and dragging selects. Typing goes to the same textarea, so
  autosave, undo, and input methods work unchanged.
- Add a **Fold** animation that folds the page into a letter and unfolds it.
  It respects reduced-motion settings.
- When WebGPU is unavailable, explain why instead of failing, and leave the
  other views working.

This change is a prototype. Out of scope:

- 3D for compare mode.
- A CSS or SVG fallback renderer.
- Exporting images or video.
- HTML-in-Canvas integration.
- Mipmapped text for very steep viewing angles.

## Capabilities

### New Capabilities

- `paper-view`: The 3D rendering of the open page: deformations, lighting,
  shadow, animation, editing through the 3D sheet, and behavior when WebGPU is
  unavailable.

### Modified Capabilities

None.

## Impact

- New `lib/paper/` modules: deformation math shared by WGSL and TypeScript,
  mesh generation, ray casting, caret mapping, page-texture painting, and the
  WebGPU renderer. The pure math is unit-tested in Node.
- New `components/PaperView.tsx` and a **3D** option in the view control.
- No new dependencies and no server changes.
