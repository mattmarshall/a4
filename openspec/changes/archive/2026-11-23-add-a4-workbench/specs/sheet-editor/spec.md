# Spec Delta

## Purpose

Lets the author write agent context directly onto the quantized sheet and see,
row by row, how much of the physical page it consumes.

## ADDED Requirements

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
Rows past the last page row SHALL render below the bottom edge of the sheet in
a visually distinct overflow zone, and the sheet SHALL show how many rows have
overflowed.

#### Scenario: Text runs off the page
- **GIVEN** the Terminal preset
- **WHEN** the text uses 64 rows
- **THEN** rows 61 through 64 render in the overflow zone and the sheet reports 4 rows over

### Requirement: Zoom
The system SHALL let the user zoom the sheet in and out and SHALL offer an
actual-size setting at 1 CSS millimeter per sheet millimeter.

#### Scenario: Actual size
- **WHEN** the user selects actual size
- **THEN** the sheet renders 210 CSS millimeters wide

### Requirement: Autosave
The system SHALL save page text and the active preset and lens in browser
storage and restore them on reload. If storage is unavailable, editing SHALL
continue to work without saving.

#### Scenario: Reload restores the page
- **GIVEN** the user has typed text on the sheet
- **WHEN** the user reloads the page
- **THEN** the same text, preset, and lens are restored

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
