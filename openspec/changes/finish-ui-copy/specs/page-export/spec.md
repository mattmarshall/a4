# Spec Delta

## ADDED Requirements

### Requirement: A failed export is reported
If Export all fails, the system SHALL download nothing and SHALL say so in a
message of the form "Couldn’t export the pages: <why>", the form every failed
library action uses. The reason SHALL be A4's sentence for the error, not the
browser's own wording.

#### Scenario: The browser refuses access during an export
- **GIVEN** the browser refuses access to the library's storage
- **WHEN** the user chooses Export all
- **THEN** no file downloads, and a message says "Couldn’t export the pages: The browser didn’t allow access."

#### Scenario: Storage isn't ready
- **GIVEN** the library's storage hasn't started
- **WHEN** the user chooses Export all
- **THEN** no file downloads, and a message says "Couldn’t export the pages: Storage isn’t ready yet."
