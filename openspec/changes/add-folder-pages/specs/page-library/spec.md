# Spec Delta

## MODIFIED Requirements

### Requirement: Current page header
The workbench SHALL show the open page's name, editable in place to rename,
together with its save status. For a folder file, the header SHALL show the
folder's name and the file's path instead, which SHALL NOT be editable.

#### Scenario: Renaming from the header
- **WHEN** the user edits the page name in the header and presses Enter
- **THEN** the page is renamed and the library shows the new name

#### Scenario: A folder file in the header
- **GIVEN** the folder "a4" is open
- **WHEN** the user opens ".claude/skills/review/SKILL.md"
- **THEN** the header shows "a4" and ".claude/skills/review/SKILL.md" with the save status, and the path can't be edited
