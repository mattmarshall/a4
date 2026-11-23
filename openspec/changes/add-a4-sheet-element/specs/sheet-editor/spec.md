# Spec Delta

## MODIFIED Requirements

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
