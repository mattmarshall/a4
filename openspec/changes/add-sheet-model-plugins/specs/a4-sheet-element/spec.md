# Spec Delta

## MODIFIED Requirements

### Requirement: Configuration attributes
The element SHALL read these attributes and re-render when they change:
- `preset`: terminal, pica, elite, or dense.
- `lens`: ink, syntax, repetition, structure, tokens, or `model:<name>` for a
  plane set on the element.
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

## ADDED Requirements

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
