# Spec Delta

## ADDED Requirements

### Requirement: Imported names are valid
Names A4 derives from file names or text, for import, migration, or copies,
SHALL always be valid page names. An import SHALL NOT stop partway because
of a name.

#### Scenario: A file name that starts with spaces and dots
- **WHEN** the user imports a zip holding " . .x.md" and "Brief.md"
- **THEN** both become pages, the first under a valid name such as "x", and the import report lists both

### Requirement: Failed library actions are reported
If opening, duplicating, restoring, or permanently deleting a page fails, A4
SHALL say so in a message, and the library SHALL stay as it was.

#### Scenario: Restoring fails
- **GIVEN** the page store rejects writes
- **WHEN** the user restores a page from the trash
- **THEN** a message says the page couldn't be restored, and it stays in the trash
