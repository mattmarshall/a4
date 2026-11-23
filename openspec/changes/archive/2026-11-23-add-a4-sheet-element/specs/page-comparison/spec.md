# Spec Delta

## MODIFIED Requirements

### Requirement: Two-page compare mode
The system SHALL offer a compare mode that shows two library pages, A and B,
as two sheets side by side in the current rendering (3D or Flat), on the same
preset and lens. Each sheet SHALL be independently editable and autosaved. The
user SHALL choose which page is shown in each slot from the library.

#### Scenario: Entering compare mode
- **WHEN** the user switches to compare mode
- **THEN** two sheets labeled A and B are shown, and typing in one does not change the other

#### Scenario: Choosing page B
- **WHEN** the user picks page "Narrative" for slot B
- **THEN** sheet B shows "Narrative" and edits to it are saved to that page

#### Scenario: Comparing in 3D
- **GIVEN** the 3D rendering
- **WHEN** the user switches to compare mode
- **THEN** both pages render as 3D sheets that share the camera and light, and each keeps its own fold and curl
