# Tasks

## 1. Top bar and menus

- [x] 1.1 Add a reusable `Menu` component, and build the one-row top bar: mark, Pages, the page name and save status, lens, Single/Compare, zoom, the Inspector toggle, and the Page, View, and Help menus. Remove the docbar. Verify in the browser that the bar is one row at most 56 px tall at 1440 × 900 (and still one row at 1100 × 800), and that every former control is reachable (Pica preset, Print, Why A4?)

## 2. Desk tools, pose panel, and lens chip

- [x] 2.1 Float the desk tools (Fold, Pose…) and a dismissible pose panel holding `SheetControls`, and show the lens legend as a desk chip for non-Ink lenses. Verify in the browser that Fold works with the panel closed, that tilting doesn't move the page in the layout, and that the chip appears for Structure and disappears for Ink

## 3. Inspector and focus mode

- [x] 3.1 Add collapsible, remembered `InspectorSection`s with the specified defaults (opening Models for a model lens), a Findings count badge, and the Inspector toggle with the top-bar verdict chip and the narrow-window drawer. Verify all three hiding-the-inspector and collapsible-inspector scenarios in the browser, including a 900 px window
- [x] 3.2 Add focus mode (View → Focus, the F key when nothing editable has focus, Esc, and the exit pill). Verify both focus scenarios in the browser

## 4. The page fits the desk

- [x] 4.1 Size the 3D stage to the desk's height, and make Flat Fit use width and height. Verify in the browser at 1440 × 900, in 3D and Flat, that the page area starts within 70 px of the top and the whole sheet is visible; and print to PDF to confirm the print layout still shows only the page

## 5. Documentation

- [x] 5.1 Update the README (layout, where controls live, focus mode), and verify `pnpm check` and `openspec validate add-workspace-focus --strict` pass

## Workflow follow-up

- Commit and push to deploy, then archive this change.
