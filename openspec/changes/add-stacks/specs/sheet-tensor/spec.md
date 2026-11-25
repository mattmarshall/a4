# Spec Delta

## MODIFIED Requirements

### Requirement: Grid shape
The grid SHALL have the page's column count for its preset and size, and as
many rows as the larger of the page's row count and the laid-out rows. The
record SHALL state how many rows are used. A page that fits SHALL therefore
always have its page's shape.

#### Scenario: A page that fits
- **WHEN** a page using 12 rows is encoded on the Terminal preset
- **THEN** the grid is 60 rows by 80 columns and 12 rows are used

#### Scenario: An overflowing page
- **WHEN** a page laying out to 67 rows is encoded on the Terminal preset
- **THEN** the grid is 67 rows by 80 columns and 67 rows are used

#### Scenario: An A5 page
- **WHEN** a page using 12 rows is encoded on an A5 Terminal page
- **THEN** the grid is 42 rows by 56 columns and 12 rows are used

### Requirement: Sheet record
The system SHALL represent a sheet that crosses a process, worker, or file
boundary as a versioned protobuf message. The message SHALL carry the page
spec, including its paper size, the text, and the grid. A record without a
paper size SHALL be read as A4. Reading a record whose grid does not decode to
its text SHALL fail with an error that names the first mismatching row.

#### Scenario: A consistent record
- **WHEN** a sheet record for "hello" is written to bytes and read back
- **THEN** the text, spec, and grid are unchanged

#### Scenario: A corrupt record
- **GIVEN** a record whose text is "hello" but whose grid holds "help"
- **WHEN** it is read
- **THEN** reading fails with an error naming row 0

#### Scenario: A record from before paper sizes
- **GIVEN** a sheet record written without a paper size
- **WHEN** it is read
- **THEN** its page is A4
