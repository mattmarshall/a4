# Design

## Context

See proposal.md for why the page renders itself rather than capturing the
DOM. The flat sheet, the textarea, and autosave stay unchanged; the 3D view is
another way to draw slot A.

## Goals / Non-Goals

**Goals:**

- Folds and curls that never stretch the paper, so text never distorts.
- Exact click-to-caret mapping on a curved surface.
- One deformation definition, written once in TypeScript and once in WGSL, with
  both covered by the same tests.

**Non-Goals:**

- Physical simulation.
- Soft shadows.
- More than one page in 3D.

## Decisions

### Coordinates

The paper uses millimeters, with `x` across (0 to 210) and `y` down the page
(0 to 297). The world places the desk at height 0, with X to the right, Y up,
and Z toward the viewer. A flat page point `(x, y)` sits at world position
`(x, 0, y)`, centered on the origin.

### Deformations as a chain of isometries

1. **Curl.** A line crosses the bottom-right corner, perpendicular to the
   direction `n`. Points at a signed distance `s > 0` past the line wrap
   around a cylinder of radius `R`:
   - If `s ≤ πR`, the point moves to `s' = R sin(s/R)` at height
     `R(1 − cos(s/R))`.
   - Beyond the half-turn, the paper runs back flat at height `2R`.
   - Arc length is preserved.
2. **Folds.** The rounded-crease fold works in the panel's local frame: `d` is
   the distance from the hinge and `h` the height above the panel. A crease of
   radius `r` and angle `α` maps the point to the arc point at `min(d, rα)`,
   continues along the arc's end tangent for the rest, and offsets it by `h`
   along the arc's normal. This preserves length along the surface and carries
   any earlier curl with it.

   The bottom panel folds about 198 mm with radius 1.5 mm. The top panel folds
   about 99 mm with radius 3 mm, so at full fold it rests above the bottom
   panel. The fold angle is `amount × π`.

Curl and fold are exclusive. Combining them would mean offsetting a curled
flap, which sits up to 2R above the sheet, around a crease of radius 1.5 mm. A
curve offset by more than its own radius folds back on itself, which would
stretch the paper.

The same functions exist in `lib/paper/deform.ts` and in WGSL. Tests check that
the deformation is an isometry using finite differences.

### Normals

The vertex shader evaluates the deformation at `(u ± ε, v)` and `(u, v ± ε)`
and takes the cross product. This avoids writing analytic Jacobians for each
deformation.

### Page texture from the model

`lib/paper/texture.ts` paints the page into an `OffscreenCanvas` at 6 to 10 px
per mm, depending on screen density. It draws:

- The paper.
- Each character at its cell, with lens colors from `segmentsFor`.
- The rulers, row numbers, and margin gauge.
- The selection and the caret.

Characters are drawn one cell at a time with the page font, using the CSS
half-leading baseline. Drawing per cell guarantees the grid positions even if
the canvas measures text slightly differently from the DOM. The texture is
uploaded with `copyExternalImageToTexture` whenever the text, lens, or
selection changes.

### Rendering

- One render pass at 4× MSAA, with a depth buffer.
- The clear color is the desk color from the CSS tokens.
- **Shadow:** the paper mesh is projected onto the desk plane along the light
  direction and blended with `min`. Overlapping folds then darken the desk
  once rather than twice. This is a hard planar shadow, which is acceptable
  for a prototype.
- **Paper:**
  - Diffuse lighting plus a little ambient light and a weak highlight.
  - Procedural fiber noise in the albedo and normal.
  - A crease darkening factor passed from the vertex shader.
  - The back side uses `front_facing` to show plain, slightly darker paper.
- **Mesh:** 72 × 102 segments, rendered with no culling. The camera uses a
  perspective projection with a tilt and a yaw.

### Editing through the 3D sheet

The textarea from the flat view stays mounted and focused, but visually hidden
(opacity 0, no pointer events, zero height, `focus({ preventScroll: true })`).
Pointer handling on the canvas works like this:

1. The canvas pixel becomes a world-space ray through the inverse
   view-projection matrix.
2. The ray is tested against the CPU copy of the deformed mesh, keeping the
   nearest triangle hit.
3. Only front-facing hits count, judged from the triangle normal and the ray.
4. The barycentric coordinates give the paper position in millimeters, then a
   grid cell, then a text offset through `layoutRows`.
5. `setSelectionRange` places the caret. Dragging extends from the anchor.

Selection changes trigger a texture repaint (from `selectionchange`, `select`,
`input`, and `keyup`).

### Fallback

`navigator.gpu` is missing, `requestAdapter()` returns null, or device setup
throws: in each case the view shows a message and nothing else changes.

## Risks / Trade-offs

- [The TypeScript and WGSL deformations drift apart] → Both live next to each
  other in `lib/paper/`, and the browser check compares a CPU ray-cast hit
  against the rendered result.
- [Text shimmers at steep angles without mipmaps] → The texture resolution
  follows screen density and the tilt is capped at 65°. Mipmapping is
  deferred.
- [The canvas draws glyphs slightly differently from the DOM] → Glyphs are
  placed per cell, so positions match even where antialiasing differs.
- [The hidden textarea is still a tab stop] → That is intended: keyboard users
  edit the same way in both views.
