# Spec Delta

## ADDED Requirements

### Requirement: Read-only sheets
The element SHALL accept a boolean `readonly` attribute, reflected by a
`readOnly` property. While it is set, typing, pasting, dropping, cutting, undo,
and redo SHALL NOT change the text or dispatch `input`. Selecting, copying,
lenses, renderings, the fold, and print SHALL still work.

#### Scenario: Pasting into a read-only sheet
- **GIVEN** a sheet with `readonly` set, holding "Sealed."
- **WHEN** the user pastes "more" at the end
- **THEN** the value is still "Sealed." and no `input` event is dispatched

#### Scenario: Copying from a read-only sheet
- **GIVEN** a sheet with `readonly` set
- **WHEN** the user selects a line and copies it
- **THEN** the clipboard holds that line
