# sheet-editor Specification

## Purpose

Lets the author write agent context directly onto the quantized sheet and see,
row by row, how much of the physical page it consumes.

## Requirements

### Requirement: Direct writing on the sheet
The system SHALL let the user type, paste, select, and delete text directly on
the sheet, starting at the top-left cell of the grid.

#### Scenario: Typing places text on the grid
- **WHEN** the user focuses the sheet and types "Hello"
- **THEN** the five characters appear in columns 1 through 5 of row 1

### Requirement: Character wrap at the right margin
A line longer than the column count SHALL wrap onto the next row after exactly
that many characters, regardless of word boundaries, punctuation, or spaces.
Each wrapped row SHALL count as a used row.

#### Scenario: Long line wraps at column 80
- **GIVEN** the Terminal preset
- **WHEN** the user enters a single line of 170 characters
- **THEN** the line occupies 3 rows, with 80, 80, and 10 characters

#### Scenario: Punctuation does not move the wrap point
- **GIVEN** the Terminal preset
- **WHEN** a line's 81st character is a comma
- **THEN** the comma starts the second row

### Requirement: Whitespace normalization
The system SHALL insert two spaces when the user presses Tab on the sheet, SHALL
convert tab characters in pasted text to two spaces, and SHALL convert CRLF and
CR line endings to LF.

#### Scenario: Pasting tab-indented text
- **WHEN** the user pastes "a\tb\r\nc"
- **THEN** the page text becomes "a  b\nc"

### Requirement: Rulers
The sheet SHALL show a column ruler in the top margin with a label at every 10th
column, and row numbers in the left margin for every 5th row.

#### Scenario: Column ruler labels
- **GIVEN** the Terminal preset
- **WHEN** the sheet is displayed
- **THEN** the top margin shows labels 10, 20, 30, 40, 50, 60, 70, and 80 above those columns

### Requirement: Visible overflow
In the flat rendering, rows past the last page row SHALL render below the
bottom edge of the sheet in a visually distinct overflow zone. In both
renderings, the sheet SHALL show how many rows have overflowed.

#### Scenario: Text runs off the page
- **GIVEN** the Terminal preset and the flat rendering
- **WHEN** the text uses 64 rows
- **THEN** rows 61 through 64 render in the overflow zone and the sheet reports 4 rows over

#### Scenario: Overflow in 3D
- **GIVEN** the Terminal preset and the 3D rendering
- **WHEN** the text uses 64 rows
- **THEN** the paper shows its 60 rows and a note in the bottom margin says 4 rows are over the page

### Requirement: Zoom
The system SHALL let the user zoom the sheets in and out and SHALL offer an
actual-size setting. In the flat rendering, actual size is 1 CSS millimeter per
sheet millimeter. In 3D, zoom sets the camera distance, and actual size makes
an untilted sheet 210 CSS millimeters wide.

#### Scenario: Actual size
- **WHEN** the user selects actual size in the flat rendering
- **THEN** the sheet renders 210 CSS millimeters wide

#### Scenario: Actual size in 3D
- **GIVEN** the 3D rendering with tilt 0
- **WHEN** the user selects actual size
- **THEN** the sheet's width on screen is 210 CSS millimeters within 2%

### Requirement: Autosave
The system SHALL save the active preset, lens, grid, view mode, and open
pages in browser storage and restore them on reload. Page text SHALL be
persisted by the page store under the autosave guarantees. If browser storage
is unavailable, editing SHALL continue to work.

#### Scenario: Reload restores the page
- **GIVEN** the user has typed text on the sheet
- **WHEN** the user reloads the page
- **THEN** the same page, text, preset, and lens are restored

#### Scenario: Storage is blocked
- **GIVEN** browser storage throws on access
- **WHEN** the user types on the sheet
- **THEN** the text appears and analysis updates, without an error

### Requirement: Clear page
The system SHALL provide a control that empties the active page after the user
confirms.

#### Scenario: Clearing a page
- **WHEN** the user chooses Clear and confirms
- **THEN** the page text is empty and the metrics show an empty page

### Requirement: Save shortcut feedback
Pressing Cmd/Ctrl+S SHALL save pending edits and say "Saved" only when every
open page saved. If a save failed, it SHALL say that saving failed and that
A4 will keep retrying.

#### Scenario: Saving while storage fails
- **GIVEN** the page store rejects writes
- **WHEN** the author presses Cmd/Ctrl+S
- **THEN** A4 says saving failed and will retry, and does not say "Saved"
