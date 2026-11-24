# Proposal

## Why

`lib/element/a4-sheet.ts` (710 lines) does everything in one class:
editing, attribute parsing, flat painting, the 3D lifecycle, picking,
printing, and events. The 3D path:
- repaints and re-uploads the whole page texture on every orbit or fold
  frame;
- writes the paper deformation twice, in WGSL and in TypeScript, kept "in
  step" by hand;
- recomputes the paper geometry in more than a dozen places.

Painting is 190 untested lines, and its colors already differ from the
shadow CSS. The review (`docs/tech-debt-review.md` E3, E4, E7–E15) lists
each. Orbit and fold also leave the attributes stale, and fixing dropped
text that contains tabs wipes native undo.

## What Changes

- **A pure state reducer:** `lib/render/element/state.ts` takes attribute
  changes, orbit, and fold, and returns the next state, with Node tests. It
  uses the `ATTRIBUTES` table from refactor-typed-contracts.
- **Controllers inside the element**, each with a small interface:
  - `EditorSurface`: the textarea, normalization, Tab and paste, selection,
    focus, and IME. It is the only owner of native editing.
  - `FlatView`: the page canvas and paper.
  - `PaperView`: the renderer state machine, device-loss recovery, change
    tracking, and orbit and pick input.
  - `PrintLayer`.
- **Change tracking:** the 3D texture repaints only when the content
  changes (text, lens, plane, preset, selection). Orbit and fold update only
  uniforms and vertices.
- **One deformation:** the paper is deformed on the CPU when the pose
  changes, and vertices are uploaded. The shader only transforms.
  `Deformed.crease` is removed if nothing uses it.
- **Painting split by layer** over a `Paint2D` interface, with a recording
  fake for Node tests. `PAINT_THEME` tokens come from the shared palette, so
  the canvas and the shadow CSS can't drift.
- **An injected GPU provider:** `GpuProvider` replaces the module-level
  device. `packUniforms()` is pure and tested. The failure reason is kept for
  diagnostics.
- **A narrow page model:** the painter takes a `PageModel` (layout, line
  kinds, segments, planes), not the full `Analysis`, so the element no longer
  runs the whole analysis.
- **A narrow React handle:** `{ focus, select(start, end), fold }`, which
  waits for the element's definition. `element()` goes away.
- **Live view and pose properties:** orbit and fold update `view` and `pose`
  properties, and an event, as today. Attributes are documented as initial
  values. Setting an attribute always applies, even if it equals the
  previous value.
- **Normalizing keeps undo:** tabs and CRs in dropped or autocorrected text
  are replaced with `setRangeText` on the affected range. This keeps undo
  and the caret, and is skipped during composition.
- **Repeated definitions:** `defineA4Sheet(name)` registers a subclass for
  each extra name, so defining it more than once stays harmless, as
  specified.
- **A standalone build:** the element gets a library build entry, so the
  documented standalone import works.

## Capabilities

### New Capabilities

### Modified Capabilities
- `a4-sheet-element`: adds live `view` and `pose` properties, with
  attributes as initial values; normalizing input keeps native undo.

## Impact

- **Element and renderer:** `lib/render/element/` (split), `lib/render/paper/`
  (renderer, `GpuProvider`, `packUniforms`, CPU-only deformation),
  `lib/render/paint/` (layers, `Paint2D`, `PAINT_THEME`), and
  `lib/page/geometry.ts` (used throughout).
- **UI:** `components/A4Sheet.tsx` (handle, `toAttributes`, `diffPlanes`)
  and `components/Workbench.tsx` or `SheetStage` (handle use).
- **Docs and build:** `app/element/page.tsx`, and `vite.config.ts` (library
  entry).
- **Performance:** an orbit frame no longer repaints a page texture of up to
  8,000 glyphs.

## Out of scope

- New rendering features.
- Changing the 3D look.
- A WebGL fallback.
