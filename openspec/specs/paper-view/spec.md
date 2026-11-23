# paper-view Specification

## Purpose
Shows the open A4 page as a physical sheet in 3D that can be folded, curled,
tilted, and lit, while it stays editable and the page text remains the single
source of truth.

## Requirements

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

### Requirement: Paper does not stretch
Every deformation SHALL be an isometry of the sheet: distances measured along
the paper surface SHALL stay within 0.5% of their flat values, so text is
never stretched.

#### Scenario: Folded edge keeps its length
- **WHEN** the sheet is fully letter-folded
- **THEN** the length along the surface from the top edge to the bottom edge is still 297 mm within 0.5%

#### Scenario: Curled sheet keeps its shape
- **WHEN** the corner is fully curled
- **THEN** the length along the surface across the sheet is still 210 mm within 0.5%

### Requirement: Letter fold
The view SHALL fold the bottom third up over the middle third, then the top
third down over both, about the lines at 99 mm and 198 mm, with rounded
creases. Each fold SHALL have its own amount from 0 (flat) to 1 (folded).
Fully folded panels SHALL lie above, never through, the panels beneath them.

#### Scenario: Fully folded
- **WHEN** both fold amounts are 1
- **THEN** the sheet occupies one third of its flat footprint and no panel intersects another

### Requirement: Corner curl
The view SHALL curl the bottom-right corner around a cylinder, with an amount
from 0 (flat) to 1 (about a third of the diagonal curled), without moving any
point of the sheet that lies outside the curled region. Curl and fold SHALL
be exclusive: setting either above 0 SHALL reset the other to 0.

#### Scenario: Curling the corner
- **WHEN** the curl amount is 0.5
- **THEN** the bottom-right corner lifts off the desk and the top-left corner stays flat

### Requirement: Lighting and shadow
The sheet SHALL be lit by an adjustable directional light. The front SHALL show
the page and the back SHALL show plain paper. Creases SHALL be darker than flat
areas, and the sheet SHALL cast a shadow on the desk that follows its
deformation.

#### Scenario: Viewing the back
- **WHEN** the top panel is folded so its back faces the camera
- **THEN** that panel shows plain paper without text

### Requirement: Editing in 3D
In the 3D view, clicking a visible character cell on the front of the sheet
SHALL place the caret before that cell's character (or at the end of a shorter
row), and dragging SHALL select text. Typing SHALL edit the page through the
same text input as the flat view, so autosave, undo, and input methods behave
the same. The caret and selection SHALL be drawn on the sheet.

#### Scenario: Clicking a cell on a curled sheet
- **GIVEN** the corner is curled and the camera is tilted
- **WHEN** the user clicks the cell in row 3, column 10 of the sheet
- **THEN** the caret moves to the text offset of row 3, column 10 and typed text appears there

#### Scenario: Clicking off the page
- **WHEN** the user clicks the desk or the back of a folded panel
- **THEN** the caret does not move

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
