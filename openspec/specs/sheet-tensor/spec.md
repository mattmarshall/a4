# sheet-tensor Specification

## Purpose
Turns a page into a fixed-shape grid of cells and back again without loss, so
models can read and write a sheet as a tensor while the page text stays the
single source of truth.

## Requirements

### Requirement: Grid encoding
The system SHALL encode normalized page text into a grid with one UTF-16 code
unit per cell, laid out exactly as the editor lays out rows: a row breaks after
`cols` cells or at a newline. Cells SHALL be stored in row-major order, and
cells past a row's end SHALL hold 0.

#### Scenario: A short page
- **GIVEN** the Terminal preset (80 columns)
- **WHEN** "ab\ncd" is encoded
- **THEN** row 0 holds "ab" followed by 78 zeros, and row 1 holds "cd" followed by 78 zeros

#### Scenario: A wrapped line
- **WHEN** a line of 85 characters with no newline is encoded on the Terminal preset
- **THEN** row 0 holds its first 80 characters and row 1 holds the last 5

### Requirement: Grid shape
The grid SHALL have the preset's column count, and as many rows as the larger
of the preset's row count and the laid-out rows. The record SHALL state how
many rows are used. A page that fits SHALL therefore always have the preset's
shape.

#### Scenario: A page that fits
- **WHEN** a page using 12 rows is encoded on the Terminal preset
- **THEN** the grid is 60 rows by 80 columns and 12 rows are used

#### Scenario: An overflowing page
- **WHEN** a page laying out to 67 rows is encoded on the Terminal preset
- **THEN** the grid is 67 rows by 80 columns and 67 rows are used

### Requirement: Row metadata
For every row, the grid SHALL record the number of characters it holds and
whether it continues a wrapped line. Rows past the used rows SHALL have length
0 and no continuation.

#### Scenario: Continuation flags
- **WHEN** a 100-character line followed by "x" is encoded on the Terminal preset
- **THEN** rows 0, 1, and 2 have lengths 80, 20, and 1, and only row 1 is a continuation

#### Scenario: A line of exactly one row
- **WHEN** an 80-character line followed by "y" is encoded on the Terminal preset
- **THEN** row 0 has length 80, row 1 holds "y", and neither is a continuation

### Requirement: Lossless round trip
Decoding a grid SHALL return exactly the text that was encoded, for any
normalized text. This includes empty text, blank lines, lines whose length is
a multiple of the column count, trailing spaces, NUL characters, and surrogate
pairs.

#### Scenario: Round trip
- **WHEN** any normalized text is encoded and then decoded with the same preset
- **THEN** the decoded text equals the original, character for character

#### Scenario: Empty page
- **WHEN** the empty string is encoded on the Terminal preset
- **THEN** one row is used, with length 0, and decoding returns the empty string

### Requirement: Offsets and cells
The system SHALL map a text offset to its cell (row and column), and a cell
back to a text offset, consistently with the encoding. A cell past a row's end
SHALL map to the end of that row. A text span SHALL map to the cells it
covers, across rows.

#### Scenario: Offset to cell
- **WHEN** offset 82 of a page whose first line is 100 characters long is mapped on the Terminal preset
- **THEN** it maps to row 1, column 2

#### Scenario: Span across rows
- **WHEN** the span from offset 78 to 83 of that page is mapped
- **THEN** it covers row 0 columns 78–79 and row 1 columns 0–2

### Requirement: Sheet record
The system SHALL represent a sheet that crosses a process, worker, or file
boundary as a versioned protobuf message. The message SHALL carry the page
spec, the text, and the grid. Reading a record whose grid does not decode to
its text SHALL fail with an error that names the first mismatching row.

#### Scenario: A consistent record
- **WHEN** a sheet record for "hello" is written to bytes and read back
- **THEN** the text, spec, and grid are unchanged

#### Scenario: A corrupt record
- **GIVEN** a record whose text is "hello" but whose grid holds "help"
- **WHEN** it is read
- **THEN** reading fails with an error naming row 0
