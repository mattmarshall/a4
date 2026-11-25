# Spec Delta

## MODIFIED Requirements

### Requirement: Letter fold
The view SHALL fold the bottom third up over the middle third, then the top
third down over both, about the lines at one third and two thirds of the
sheet's own height (99 mm and 198 mm on A4, 70 mm and 140 mm on A5, 49.3 mm and
98.7 mm on A6), with rounded creases. Each fold SHALL have its own amount from
0 (flat) to 1 (folded). Fully folded panels SHALL lie above, never through, the
panels beneath them.

#### Scenario: Fully folded
- **WHEN** both fold amounts are 1
- **THEN** the sheet occupies one third of its flat footprint and no panel intersects another

#### Scenario: Folding an A5 card
- **GIVEN** an A5 page rendering in 3D
- **WHEN** both fold amounts are 1
- **THEN** the creases lie at 70 mm and 140 mm and the sheet occupies one third of its flat footprint

## ADDED Requirements

### Requirement: A sheet of the page's size
Each sheet SHALL render in 3D and flat at its page's paper size, with the text,
lenses, rulers, row numbers, and margin gauge at the same grid positions as on
the page's grid. Picking a cell, curling, lighting, and shadows SHALL work on
every size.

#### Scenario: A6 in 3D
- **GIVEN** an A6 page
- **WHEN** it renders in 3D
- **THEN** the sheet is 105 by 148 mm, and clicking its last row's first cell places the caret at the start of row 29
