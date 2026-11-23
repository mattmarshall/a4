# Design

## Context

See proposal.md. Today `components/Sheet.tsx` renders the flat sheet as DOM
spans over a transparent textarea. `components/PaperView.tsx` renders page A
in 3D and edits through an off-stage copy of the flat sheet's textarea. The
page painter (`lib/paper/texture.ts`) already draws everything a flat sheet
shows.

## Goals / Non-Goals

**Goals:**

- One sheet implementation with two renderings, usable without React.
- Unchanged editing behavior: native textarea, wrapping, Tab, paste
  normalization, undo, IME.

**Non-Goals:**

- npm packaging, form association, and a multi-sheet desk element.

## Decisions

### Element structure

`lib/element/a4-sheet.ts` defines `A4SheetElement extends HTMLElement`. The
element has an open shadow root containing:

```
<style>…</style>
<div class="stage">
  <canvas class="gpu">                 3D: WebGPU canvas (fills the host)
  <div class="flat">                   Flat: sized from mm × zoom
    <canvas class="page">              the painted page (+ overflow zone)
    <textarea class="input">           transparent, aligned to the grid
  </div>
  <div class="print" aria-hidden>      print-only rows of text
</div>
```

The same `<textarea>` owns the text in both renderings. In 3D it is
visually hidden but still focusable, and lives inside the shadow root. Because
the element instance persists when the rendering switches, the caret and
selection carry over for free.

### One painter for both renderings

`paintPage` gains three options:

- `overflow: boolean` paints rows past the page into an extra zone below the
  paper.
- `grid: boolean` draws the cell grid.
- `chrome: "texture" | "flat"` decides who draws the caret and selection. The
  painter draws them for the 3D texture. Flat rendering leaves them to the
  native textarea.

Flat rendering displays the painted canvas at `zoom` CSS px per mm (or fit to
width), and positions the textarea over the grid with the same wrapping CSS as
before (`break-spaces` and `line-break: anywhere`, half a cell of slack), so
the native caret lines up with the painted glyphs.

### Shared GPU device

`lib/paper/gpu.ts` caches one `GPUDevice` per page, created on the first
request. Each sheet configures its own canvas context against that device, so
two sheets in compare mode don't create two devices. A renderer no longer
destroys the device; the device is released when the page unloads.

### Zoom in 3D

`camera()` accepts an optional `pxPerMm` and the canvas CSS height. When set,
the camera distance becomes `cssHeight / (2 · tan(fov/2) · pxPerMm)`, so the
paper's untilted on-screen size matches the flat rendering's scale. When it is
not set, the camera fits the sheet.

### Workbench integration

`components/A4Sheet.tsx` is a small React wrapper. It:

- creates the element,
- mirrors props to attributes,
- sets `value` only when it differs,
- forwards `input`, `a4-focus`, and `a4-render` events,
- exposes the element through a ref.

The workbench renders one wrapper in single mode and two in compare mode.
`SheetControls` holds the controls:

- Each slot has its own fold and curl pose, and the controls show the active
  slot's pose.
- Tilt, turn, light, and zoom are shared across both sheets.

The rendering choice is stored as `a4:render` and defaults to "3d". If either
element reports "flat" while the choice is "3d", the workbench shows a single
notice that 3D needs WebGPU. A stored `a4:mode` of "paper" migrates to
"single".

### Print

On `beforeprint`, the element fills its print layer with each visual row as an
absolutely positioned line in millimeters, using the same font metrics. In
`@media print`, the host becomes a true-size page (210 × 297 mm, page break
after), the canvases and textarea are hidden, and only the print layer shows.

## Risks / Trade-offs

- [The transparent textarea drifts from the painted glyphs in flat rendering]
  → Both use the same cell geometry. The browser check compares the wrap
  points with `layoutRows` for edge cases, as before.
- [The custom element misbehaves under SSR] → The element is defined only in
  the browser (a dynamic import in a client effect). The server renders a
  placeholder `<a4-sheet>` that upgrades after hydration.
- [Raster text in flat rendering is less crisp than DOM text] → The painter
  runs at devicePixelRatio × zoom resolution, so text is crisp on screen.
  Print uses real text.
