# Spec Delta

## ADDED Requirements

### Requirement: Edits during a copy are kept
When a save moves the page's text to a new copy, edits typed while the copy is
being saved SHALL be kept: they SHALL be journaled under the copy and saved
to it.

#### Scenario: Typing while a conflict copy is saved
- **GIVEN** "AGENTS.md" from a folder changed on disk while the author had unsaved edits
- **WHEN** the author types more while A4 saves the library copy "AGENTS.md (conflict …)"
- **THEN** the copy ends up holding all of the typed text, and a crash at any point leaves that text in the journal

### Requirement: Drafts from this tab survive closing a page
When a page is closed or switched away from while its last save failed, its
draft SHALL stay in the journal. Reopening the page in the same tab SHALL
show that draft and save it, instead of the stored text.

#### Scenario: Reopening after a failed save
- **GIVEN** a save of "Brief" failed and the author opened another page
- **WHEN** the author reopens "Brief" in the same tab
- **THEN** the sheet shows the unsaved text, and it is saved to "Brief"
