# a4-sheet-element Specification

## Purpose
Defines `<a4-sheet>`: a self-contained custom element that renders one
editable A4 page of context, in 3D or flat, and that any web page can embed
without the rest of the A4 application.

## Requirements

### Requirement: Self-contained element
`<a4-sheet>` SHALL be an autonomous custom element whose rendering surface,
text input, and styles live in its own shadow root. It SHALL work without the
workbench, library, or any framework, and defining it more than once SHALL be
harmless.

#### Scenario: Embedding on a plain page
- **GIVEN** a page that only loads the element's module
- **WHEN** it contains `<a4-sheet value="Hello"></a4-sheet>`
- **THEN** an editable A4 sheet showing "Hello" appears

### Requirement: Value and input events
The element SHALL expose the page text as a `value` property and a `value`
attribute for the initial text. Each user edit SHALL update `value` and
dispatch a bubbling, composed `input` event. Setting `value` from script SHALL
NOT dispatch `input` and SHALL keep the caret where possible.

#### Scenario: Typing
- **WHEN** the user types "x" into the sheet
- **THEN** `value` ends with "x" and one `input` event reaches the document

#### Scenario: Programmatic update
- **WHEN** script sets `value` to the text the sheet already holds
- **THEN** no `input` event fires and the caret does not move

### Requirement: Configuration attributes
The element SHALL read these attributes and re-render when they change:
- `preset`: terminal, pica, elite, or dense.
- `lens`: ink, syntax, repetition, structure, tokens, or `model:<name>`.
- `render`: 3d, flat, or auto.
- `fold-bottom`, `fold-top`, and `curl`: 0 to 1.
- `tilt`: 0 to 65 degrees.
- `turn`: −180 to 180 degrees.
- `light`: azimuth in degrees.
- `zoom`: CSS pixels per millimeter, or "fit".
- `grid`: a boolean.

Invalid values SHALL fall back to the defaults.

#### Scenario: Changing the lens
- **WHEN** script sets `lens="syntax"` on a sheet showing JSON
- **THEN** the sheet repaints with syntax characters emphasized

### Requirement: Editing methods and events
The element SHALL provide `focus()`, `setSelectionRange(start, end)`,
`selectionStart`, `selectionEnd`, and `fold()` (play the letter-fold
animation). It SHALL dispatch `a4-focus` when it gains focus, and
`a4-render` with the active rendering ("3d" or "flat") whenever that changes.

#### Scenario: Placing the caret from script
- **WHEN** script calls `setSelectionRange(5, 5)` and then `focus()`
- **THEN** typing inserts text at offset 5

### Requirement: Rendering modes and fallback
With `render="3d"` or `auto`, the element SHALL render with WebGPU. If WebGPU is
unavailable, it SHALL render flat instead and report "flat" through
`a4-render`. With `render="flat"`, it SHALL render a flat sheet painted from
the same page model, with a transparent text input aligned to the grid so
native caret, selection, and input methods work.

#### Scenario: No WebGPU
- **GIVEN** a browser without WebGPU
- **WHEN** an `<a4-sheet>` with `render="auto"` connects
- **THEN** it renders flat, stays editable, and dispatches `a4-render` with "flat"

### Requirement: Print layer
When printed, each element SHALL produce one true-size A4 page showing only
the page text in black at the preset's cell size and margins, with no lens
colors, gauges, overflow rows, or 3D effects.

#### Scenario: Printing a 3D sheet
- **GIVEN** a sheet rendering in 3D with the corner curled
- **WHEN** the page is printed
- **THEN** the printout is a flat, true-size A4 page of the sheet's text

### Requirement: Model planes
The element SHALL provide `setPlane(name, plane)` and `removePlane(name)`. A
plane SHALL carry the text it was computed for and one value per cell of that
text's grid. With `lens="model:<name>"`, the element SHALL paint the plane in
3D and flat, but only while its value equals the plane's text. Otherwise it
SHALL paint the Ink lens. A plane of the wrong size SHALL be rejected.

#### Scenario: Showing a plane
- **GIVEN** a sheet holding "Hello world"
- **WHEN** script sets a plane "heat" computed for "Hello world" and sets `lens="model:heat"`
- **THEN** the sheet tints its cells by the plane's values in the active rendering

#### Scenario: A plane of the wrong size
- **WHEN** script sets a plane whose value count does not match its text's grid
- **THEN** `setPlane` throws a RangeError and the sheet's planes are unchanged

#### Scenario: Text changed after scoring
- **GIVEN** a sheet showing the plane "heat" with `lens="model:heat"`
- **WHEN** the user types a character
- **THEN** the sheet paints the Ink lens until a plane for the new text is set
