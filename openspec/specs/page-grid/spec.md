# page-grid Specification

## Purpose

Defines the quantized A4 page: the physical sheet, the monospace cell grid laid
over it, and the capacity that grid represents in cells and estimated tokens.

## Requirements

### Requirement: A4 sheet proportions
The system SHALL render an A4 page as a sheet of 210 x 297 mm, and every page,
whatever its size, SHALL keep the A-series 1:1.414 aspect ratio at every zoom
level.

#### Scenario: Sheet keeps A4 proportions when zoomed
- **WHEN** the user changes the zoom level
- **THEN** the rendered sheet's height divided by its width remains 297/210 within 0.5%

#### Scenario: An A5 sheet keeps its proportions
- **GIVEN** an A5 page open on the sheet
- **WHEN** the user changes the zoom level
- **THEN** the rendered sheet's height divided by its width remains 210/148 within 0.5%

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
The system SHALL display an estimated token ceiling for the page's preset and
size equal to the capacity in cells divided by 4, rounded down, labeled as an
estimate.

#### Scenario: Terminal page token ceiling
- **WHEN** the Terminal preset is active
- **THEN** the token ceiling reads approximately 1,200 tokens

#### Scenario: An A5 card's token ceiling
- **GIVEN** an A5 page on the Terminal preset
- **WHEN** its metrics are shown
- **THEN** the token ceiling reads approximately 588 tokens

### Requirement: Character-to-cell mapping
Every character of page text SHALL occupy exactly one cell, using a monospace
typeface whose advance width equals the preset's cell width.

#### Scenario: A full row holds exactly the column count
- **GIVEN** the Terminal preset
- **WHEN** the user types a line of exactly 80 characters
- **THEN** the line fills one row from the first to the last column without wrapping

### Requirement: The fold ladder
A page SHALL be A4 (210 x 297 mm), A5 (148 x 210 mm), or A6 (105 x 148 mm).
Each fold halves the paper. Cells SHALL keep the preset's size, so text reads
at the same point size, and margins SHALL shrink by the same factor as the
paper's sides. Columns and rows SHALL be the whole number of cells that fit
inside the margins: on Terminal, 80 x 60 for A4, 56 x 42 for A5, and 40 x 29
for A6.

#### Scenario: An A5 card on Terminal
- **GIVEN** the Terminal preset
- **WHEN** an A5 page opens
- **THEN** the grid is 56 columns by 42 rows and the capacity reads 2,352 cells

#### Scenario: An A6 postcard on Terminal
- **GIVEN** the Terminal preset
- **WHEN** an A6 page opens
- **THEN** the grid is 40 columns by 29 rows and the capacity reads 1,160 cells

### Requirement: A page's size comes from its name
A page whose name, without its `.md` or `.mdc` extension, ends in `.a5` or `.a6`
(in any case) SHALL be that size. Every other page SHALL be A4. The rule SHALL
apply alike to library pages and folder files, and the sheet SHALL say the
page's size with its grid.

#### Scenario: A folder file named as a card
- **WHEN** the user opens the folder file `docs/auth-card.a5.md`
- **THEN** it opens as an A5 page and the sheet says "A5" with its 56 x 42 grid

#### Scenario: A library page named as a postcard
- **WHEN** the user opens the library page "Deploy note.a6"
- **THEN** it opens as an A6 page

#### Scenario: Context files are A4
- **WHEN** the user opens `CLAUDE.md`
- **THEN** it opens as an A4 page
