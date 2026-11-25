# Spec Delta

## MODIFIED Requirements

### Requirement: Configuration attributes
The element SHALL read these attributes and re-render when they change:
- `preset`: terminal, pica, elite, or dense.
- `size`: a4, a5, or a6.
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

#### Scenario: Folding the paper to A5
- **WHEN** script sets `size="a5"` on a Terminal sheet
- **THEN** the sheet re-renders as a 148 by 210 mm page with a 56 by 42 grid

### Requirement: Print layer
When printed, each element SHALL produce one true-size page of its paper size
(A4, A5, or A6) showing only the page text in black at the preset's cell size
and margins, with no lens colors, gauges, overflow rows, or 3D effects.

#### Scenario: Printing a 3D sheet
- **GIVEN** a sheet rendering in 3D with the corner curled
- **WHEN** the page is printed
- **THEN** the printout is a flat, true-size A4 page of the sheet's text

#### Scenario: Printing an A6 sheet
- **GIVEN** a sheet with `size="a6"`
- **WHEN** the page is printed
- **THEN** the printout is a true-size A6 page of the sheet's text
