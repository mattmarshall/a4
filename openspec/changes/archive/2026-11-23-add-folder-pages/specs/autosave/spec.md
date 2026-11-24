# Spec Delta

## MODIFIED Requirements

### Requirement: Page deleted elsewhere
When a save fails because the page no longer exists, the system SHALL
recreate it from the unsaved text under its name, or under a unique name when
that name has been taken, and tell the user. When the missing page is a
folder file, the system SHALL NOT recreate the file. It SHALL save the unsaved
text as a library page named "<path> (recovered <date> <time>)", open that
page, and tell the user.

#### Scenario: Deleted in another tab
- **GIVEN** tab 1 has unsaved edits to "Brief" and tab 2 moves "Brief" to the trash
- **WHEN** tab 1 saves
- **THEN** a page holding tab 1's text exists in the library

#### Scenario: File deleted on disk
- **GIVEN** "AGENTS.md" from the open folder has unsaved edits, and `git checkout` removes the file
- **WHEN** A4 saves
- **THEN** no "AGENTS.md" is created in the folder, and a library page "AGENTS.md (recovered …)" holds the unsaved text and opens
