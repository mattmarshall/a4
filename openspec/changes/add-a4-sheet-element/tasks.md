# Tasks

## 1. Shared pieces

- [x] 1.1 Add the shared GPU device, camera zoom (`pxPerMm`), and painter options (overflow, grid, chrome), and verify Node tests for camera zoom and print-row layout
  - Verified: `pnpm test` passes (138 tests), including "camera zoom: an untilted sheet spans 210 × pxPerMm CSS px" and the print-row tests.

## 2. The element

- [x] 2.1 Implement `<a4-sheet>` (shadow root, attributes, `value`, events, methods, 3D and flat renderings, fallback, picking, orbit, Tab and paste handling, print layer), and verify in the browser on a page that uses only the element
  - Verified on `/element` (plain markup): both elements upgrade, one in 3D and one flat; typing fires composed `input` events; setting `value` from script fires none and keeps the caret.
  - The print layer stays current from the paint loop, so it doesn't depend on `beforeprint`. Pointer capture tolerates a pointer that is already gone.
- [x] 2.2 Verify in the browser that flat wrap points match `layoutRows` for the earlier edge cases, and that typing, selection, undo, and paste work in both renderings
  - Verified: all 8 flat wrap edge cases match `layoutRows`. In 3D, a real click places the caret, typing lands, undo and redo restore the text, and paste turns tabs into two spaces and CRLF into LF, inserts at the caret, and is undoable.
  - Caveat: the browser pane's synthetic Cmd+Z doesn't reach macOS's undo command, so undo was driven with the editing command rather than the keystroke.

## 3. Workbench

- [x] 3.1 Replace `Sheet` and `PaperView` with the `A4Sheet` wrapper and `SheetControls`, make 3D the default with a Flat choice and WebGPU notice, migrate the stored mode, and verify single and compare in both renderings in the browser
  - Verified: 3D is the default. Single shows one sheet and Compare two, in both renderings. The stored mode `paper` migrates to `single`, and the controls hide in Flat.
  - Pressing a sheet makes it active, which retitles the controls ("Sheet B"). Fold animates only the active sheet and reports its final pose.
  - Not verified: the WebGPU-unavailable notice, because this browser has WebGPU. The fallback path sets `render` to flat and dispatches `a4-render`.
- [x] 3.2 Verify autosave, compare editing, caret round trip between renderings, and print (true-size text from a 3D sheet) in the browser
  - Verified: text typed on sheet B saved to B's `.md` and left A unchanged, and the caret survived switching to Flat.
  - Print was verified with headless Chrome's `Page.printToPDF`. Single gives one true-size A4 page of black text at 16/15 mm margins, from a 3D sheet. Compare gives two pages, and `/element` gives each sheet its own page.

## 4. Documentation and integration

- [x] 4.1 Update README for `<a4-sheet>` (usage, attributes, events) and verify `pnpm check` and `openspec validate add-a4-sheet-element --strict` pass
  - Verified: `pnpm check` (tests, typecheck, build with `/`, `/element`, and `/why` prerendered) and `openspec validate add-a4-sheet-element --strict` pass.

## Workflow follow-up

- Commit and push to deploy, then archive this change.
