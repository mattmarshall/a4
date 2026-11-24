# Tasks

## 1. Pure pieces

- [ ] 1.1 Add `state.ts` (the attribute, orbit, and fold reducer from the `ATTRIBUTES` table) and `packUniforms()` with the WGSL offset test. Verify with Node tests
- [ ] 1.2 Split painting into layers over `Paint2D`, with `PAINT_THEME` from the shared palette, and a recording fake. Verify with Node tests for the layers, and screenshots before and after (flat, every lens) that match

## 2. Controllers

- [ ] 2.1 Extract `EditorSurface` with `setRangeText` normalization (no normalizing during composition). Verify the "Normalizing keeps undo" scenario in the browser, plus typing, paste, Tab, selection, and an IME composition
- [ ] 2.2 Extract `FlatView`, `PaperView` (state union, device loss, token, change flags, injected `GpuProvider`), and `PrintLayer`. Verify in the browser that orbiting repaints no texture (a counter in dev), fold and curl look unchanged, device loss falls back, and print to PDF still gives one page of text
- [ ] 2.3 Deform on the CPU only and remove the WGSL deformation. Verify that the paper tests pass, and 3D screenshots for fold and curl match within tolerance

## 3. Contract and wrapper

- [ ] 3.1 Add the live `view` and `pose` properties and always-applied attributes, and narrow the React handle to `{ focus, select, fold }` (waiting on `whenDefined`). Verify the "Resetting the camera after an orbit" scenario in the browser, and that the Workbench selection and focus behavior is unchanged
- [ ] 3.2 Make `defineA4Sheet` register a subclass per extra name, and add the library build entry for the standalone element. Verify that defining twice doesn't throw, and the built file works in a plain HTML page

## 4. Integration

- [ ] 4.1 Run `pnpm check`, `pnpm lint`, and `openspec validate refactor-sheet-element --strict`. In the production preview, check 3D, flat, Compare orbit, lenses, planes, print, and the `/element` page

## Workflow follow-up

- Commit and push to deploy, then archive this change.
