# Spec Delta

## ADDED Requirements

### Requirement: Live view and pose properties
The element SHALL expose `view` (`{ tilt, turn }`) and `pose` (fold and curl
amounts) as properties that always reflect what is shown, including after
the user orbits the camera or `fold()` plays. The `tilt`, `turn`,
`fold-bottom`, `fold-top`, and `curl` attributes SHALL set the initial and
requested values: setting one SHALL apply it even when it equals the previous
attribute value.

#### Scenario: Resetting the camera after an orbit
- **GIVEN** a 3D sheet with `tilt="32"` that the user orbited to a tilt of 50
- **WHEN** script sets `tilt="32"` again
- **THEN** the sheet returns to a tilt of 32, and `view.tilt` reads 32

### Requirement: Normalizing keeps undo
When input inserts tab or carriage-return characters (for example, dropped
or autocorrected text), the element SHALL replace only the affected range,
keeping the caret's position relative to the text and the browser's undo
history. It SHALL NOT normalize while an input method is composing.

#### Scenario: Undo after dropping tabbed text
- **GIVEN** the sheet holds "abc"
- **WHEN** the user drops "x\ty" after "abc" and then presses Cmd/Ctrl+Z
- **THEN** the sheet shows "abcx  y" after the drop, and "abc" after the undo
