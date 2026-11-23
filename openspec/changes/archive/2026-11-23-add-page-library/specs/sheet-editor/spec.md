# Spec Delta

## MODIFIED Requirements

### Requirement: Autosave
The system SHALL save the active preset, lens, grid, view mode, and open
pages in browser storage and restore them on reload. Page text SHALL be
persisted by the page store under the autosave guarantees. If browser storage
is unavailable, editing SHALL continue to work.

#### Scenario: Reload restores the page
- **GIVEN** the user has typed text on the sheet
- **WHEN** the user reloads the page
- **THEN** the same page, text, preset, and lens are restored

#### Scenario: Storage is blocked
- **GIVEN** browser storage throws on access
- **WHEN** the user types on the sheet
- **THEN** the text appears and analysis updates, without an error
