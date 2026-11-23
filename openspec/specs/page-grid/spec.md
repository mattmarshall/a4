# page-grid Specification

## Purpose

Defines the quantized A4 page: the physical sheet, the monospace cell grid laid
over it, and the capacity that grid represents in cells and estimated tokens.

## Requirements

### Requirement: A4 sheet proportions
The system SHALL render the page as an A4 sheet of 210 x 297 mm and SHALL
preserve that 1:1.414 aspect ratio at every zoom level.

#### Scenario: Sheet keeps A4 proportions when zoomed
- **WHEN** the user changes the zoom level
- **THEN** the rendered sheet's height divided by its width remains 297/210 within 0.5%

### Requirement: Canonical Terminal page
The default page preset SHALL be "Terminal": 80 columns by 60 rows of
2.225 x 4.45 mm cells, centered on the sheet (16 mm side margins, 15 mm top and
bottom margins), for a capacity of 4,800 cells.

#### Scenario: First visit uses the Terminal page
- **GIVEN** a browser with no saved A4 settings
- **WHEN** the user opens the workbench
- **THEN** the page grid is 80 columns by 60 rows and the capacity reads 4,800 cells

### Requirement: Alternate page presets
The system SHALL offer the presets Pica (10 characters per inch, 6 lines per
inch, 25.4 mm margins, 62 x 58), Elite (12 cpi, 6 lpi, 25.4 mm margins,
75 x 58), and Dense (1.8 x 3.5 mm cells, 100 x 80). Columns and rows SHALL be
the whole number of cells that fit inside the margins.

#### Scenario: Selecting the Pica preset
- **WHEN** the user selects the Pica preset
- **THEN** the grid becomes 62 columns by 58 rows and the capacity reads 3,596 cells

#### Scenario: Selecting the Dense preset
- **WHEN** the user selects the Dense preset
- **THEN** the grid becomes 100 columns by 80 rows and the capacity reads 8,000 cells

### Requirement: Token ceiling
The system SHALL display an estimated token ceiling for the active preset equal
to the capacity in cells divided by 4, rounded down, labeled as an estimate.

#### Scenario: Terminal page token ceiling
- **WHEN** the Terminal preset is active
- **THEN** the token ceiling reads approximately 1,200 tokens

### Requirement: Character-to-cell mapping
Every character of page text SHALL occupy exactly one cell, using a monospace
typeface whose advance width equals the preset's cell width.

#### Scenario: A full row holds exactly the column count
- **GIVEN** the Terminal preset
- **WHEN** the user types a line of exactly 80 characters
- **THEN** the line fills one row from the first to the last column without wrapping
