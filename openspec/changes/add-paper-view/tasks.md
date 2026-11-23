# Tasks

## 1. Geometry

- [x] 1.1 Implement the curl and rounded-fold deformations, mesh generation, and the world transform in `lib/paper/deform.ts`, and verify Node tests that each deformation is an isometry within 0.5%, that fully folded panels do not intersect, and that the curl leaves points outside its region untouched
- [x] 1.2 Implement the camera matrices, ray casting against the deformed mesh, and cell-to-caret mapping, and verify Node tests that a ray through a known cell on a curled, tilted sheet returns that cell and that back-facing and off-page hits return nothing

## 2. Rendering

- [x] 2.1 Implement the page-texture painter (paper, per-cell glyphs with lens colors, rulers, row numbers, gauge, selection, caret), and verify in the browser that flat 3D text sits in the same cells as the DOM sheet (verified with click-to-cell checks and screenshots, not a pixel-level comparison against the DOM)
- [x] 2.2 Implement the WebGPU renderer (deformation and normals in WGSL, lighting, back side, crease darkening, fiber noise, planar shadow, 4× MSAA), and verify in the browser with screenshots of the flat, folded, and curled poses

## 3. Workbench

- [x] 3.1 Add the 3D view option, the controls (fold, curl, tilt, yaw, light, Fold animation, reset), the reduced-motion behavior, and the WebGPU-unavailable message, and verify in the browser (the reduced-motion branch is implemented but was not exercised; the pane cannot emulate the preference)
- [x] 3.2 Route clicks and drags on the sheet to the textarea selection and repaint the caret and selection, and verify in the browser that clicking a cell on a curled sheet and typing edits that position and autosaves (browser clicks hit cells on a curled-pose sheet; clicks on the curled flap itself are covered by Node tests)

## 4. Documentation and integration

- [x] 4.1 Document the 3D view in README and docs/concept.md, and verify `pnpm check` and `openspec validate add-paper-view --strict` pass

## Workflow follow-up

- Commit and push to deploy, then archive this change.
