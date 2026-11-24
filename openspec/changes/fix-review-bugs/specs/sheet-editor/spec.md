# Spec Delta

## ADDED Requirements

### Requirement: Save shortcut feedback
Pressing Cmd/Ctrl+S SHALL save pending edits and say "Saved" only when every
open page saved. If a save failed, it SHALL say that saving failed and that
A4 will keep retrying.

#### Scenario: Saving while storage fails
- **GIVEN** the page store rejects writes
- **WHEN** the author presses Cmd/Ctrl+S
- **THEN** A4 says saving failed and will retry, and does not say "Saved"
