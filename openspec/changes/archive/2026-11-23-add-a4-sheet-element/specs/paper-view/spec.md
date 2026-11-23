# Spec Delta

## MODIFIED Requirements

### Requirement: 3D view mode
Every sheet in the workbench SHALL render in 3D with WebGPU by default, both
in single view and in compare view. The page's text, lens colors, rulers, row
numbers, and margin gauge SHALL appear on the sheet at the same grid positions
as in the flat rendering. The workbench SHALL offer a Flat rendering as an
explicit choice.

#### Scenario: Entering 3D
- **GIVEN** a browser with WebGPU and no saved rendering choice
- **WHEN** the user opens the workbench
- **THEN** the open page is drawn as a 3D sheet with its text in the same cells as the flat rendering

#### Scenario: Choosing Flat
- **WHEN** the user chooses the Flat rendering
- **THEN** every sheet renders flat and stays editable

### Requirement: WebGPU unavailable
When the browser does not provide WebGPU or no adapter is available, sheets
SHALL render flat, the workbench SHALL say once that 3D needs WebGPU, and every
view SHALL keep working.

#### Scenario: No WebGPU
- **GIVEN** a browser without `navigator.gpu`
- **WHEN** the user opens the workbench
- **THEN** the sheets render flat, a notice says 3D needs WebGPU, and no error is thrown

### Requirement: Single source of truth
Sheets SHALL read and write only their page's text through the existing page
sessions. Switching between 3D and Flat SHALL keep each sheet's text and caret
position.

#### Scenario: Round trip
- **GIVEN** the user typed "hello" on a 3D sheet
- **WHEN** the user switches to the Flat rendering
- **THEN** the flat sheet shows "hello" at the same place, the caret is where it was, and the page is saved

### Requirement: Fold animation
The view SHALL offer a Fold action that animates folding the active sheet into
a letter and back. The active sheet is the last one the user clicked or typed
in. When the user prefers reduced motion, the action SHALL change pose without
animating.

#### Scenario: Playing the fold
- **WHEN** the user chooses Fold
- **THEN** the active sheet's bottom third folds up, then its top third folds down, holds, and both unfold
