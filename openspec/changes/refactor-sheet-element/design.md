# Design

## Context

- **Prerequisites:**
  - refactor-typed-contracts: `ATTRIBUTES`, the event map, `SegmentStyle`.
  - refactor-lib-layout: `lib/render/`, `lib/page/geometry.ts`, the
    `PageModel` inputs.
  - fix-review-bugs: device-loss handling (B9) and the creation token (B18),
    which `PaperView` absorbs.
- **The renderer is WebGPU, not WebGL.** One `GPUDevice` is shared per page.
- **Already tested:** deformation, picking, fold animation, camera zoom,
  print rows, and heat fill.
- **Not tested:** painting, camera fit, uniforms, and the wrapper's plane
  and attribute diffing.

## Goals / Non-Goals

**Goals:**
- Every piece of logic that doesn't touch the DOM or the GPU is pure and
  tested in Node.
- 3D frames don't repaint text.
- One source for geometry, deformation, and colors.

**Non-Goals:**
- A visual redesign.
- New attributes beyond `view` and `pose`.

## Decisions

### 1. The element composes controllers

```
A4SheetElement (custom element: lifecycle, attributes → state.reduce, events)
 ├─ EditorSurface   textarea, normalization (setRangeText), selection, focus, IME
 ├─ FlatView        page canvas + paper div: update(model, scale)
 ├─ PaperView       renderer state union idle|creating{token}|ready|lost|unavailable{reason}; change flags
 └─ PrintLayer      printRows, refreshed when idle and on beforeprint/matchMedia(print)
```

The controllers receive `(state, model)`, and never read attributes or each
other.

### 2. Change tracking

- **The dirty flags:** `PaperView` keeps `{ content, view, pose, size }`.
- **Content** repaints the texture: text, lens, segments, planes,
  selection, preset, and theme.
- **Pose** re-deforms the vertices on the CPU (about 11k vertices; picking
  already does this) and uploads them.
- **View** updates the uniforms only.
- **Compare:** orbiting one sheet no longer repaints the other. Each stage
  owns its own view in `SheetStage`.

### 3. Painting

- **Layers:** `paint/` holds `paper`, `rules`, `bands`, `segments`,
  `glyphs`, `selection`, `overflow`, and `print`. Each layer is a function
  `(ctx: Paint2D, model, theme, geometry)`.
- **Tests:** a recording `Paint2D` fake checks calls for a fixed page. That
  covers selection direction, overflow rows, and plane cells.

### 4. Device and uniforms

- **Devices:** `GpuProvider = { device(): Promise<GPUDevice>; onLost(cb) }`
  is injected, with a browser provider and a test double.
- **Uniforms:** `packUniforms(view, pose, light)` returns a
  `Float32Array(32)`. Its offsets are named constants mirrored in WGSL, with
  a test that parses the WGSL struct and compares the offsets.

### 5. View and pose properties, and normalization

- **Properties:** `view` and `pose` reflect the live values.
  `attributeChangedCallback` always applies, and the React wrapper writes
  attributes even when they're unchanged, if its prop says so. That fixes
  the review's E8 without reflecting every frame back into the DOM.
- **Normalization:** on `input` with `\t` or `\r` in the inserted range,
  `setRangeText` replaces that range, and the caret is mapped. It is skipped
  while `isComposing`.

## Risks / Trade-offs

- **[3D regressions]** → Screenshots before and after for flat, 3D, fold,
  curl, and the lenses, compared side by side, plus the existing paper
  tests.
- **[CPU deformation cost]** → About 11k vertices on pose changes only.
  Picking already deforms on the CPU, so it is well within a frame. Measure
  during folding.
- **[IME]** → The textarea keeps focus and its grid position. No
  normalization during composition. Checked by hand with a Japanese IME.

## Migration Plan

The element contract only gains `view` and `pose` and the always-apply
behavior. Existing pages and embeds keep working. Reverting is a revert of
the commits.
