# Spec Delta

## MODIFIED Requirements

### Requirement: Other Markdown and skipped folders
Other `.md` files SHALL be listed in an **Other Markdown** group, collapsed by
default. Letters, the `.md` files directly inside `.agents/letters/`, SHALL be
listed in the Letters group instead. The scan SHALL skip:
- folders named `.git`, `node_modules`, `dist`, `build`, `out`, `target`,
  `vendor`, `.next`, or `.venv`;
- other folders whose names start with a period, except `.claude`, `.github`,
  `.cursor`, and `.agents`.

#### Scenario: Dependencies are skipped
- **GIVEN** the folder holds `docs/guide.md` and `node_modules/pkg/README.md`
- **WHEN** the folder is listed
- **THEN** "docs/guide.md" is under Other Markdown and nothing under `node_modules` is listed

#### Scenario: Letters aren't Other Markdown
- **GIVEN** the folder holds `.agents/letters/2026-11-25-0930-auth.md`
- **WHEN** the folder is listed
- **THEN** it is listed under Letters and not under Other Markdown

### Requirement: Creating files on request
A4 SHALL create a file only when the user asks:
- **New file in folder**, given a relative path ending in `.md` or `.mdc`;
- **Save to folder**, which writes an open library page to a new path;
- **New letter**, which creates a draft letter in `.agents/letters/`;
- sealing a letter, which writes its postmark beside it.

A4 SHALL create missing parent folders. It SHALL refuse with a message, and
change nothing, when the path already exists or points outside the folder.

#### Scenario: Adding AGENTS.md
- **GIVEN** the open folder has no `AGENTS.md`
- **WHEN** the user chooses New file in folder and enters "AGENTS.md"
- **THEN** an empty `AGENTS.md` is created at the folder's root and opens on the sheet

#### Scenario: An existing path is refused
- **GIVEN** the open folder has a `CLAUDE.md`
- **WHEN** the user saves the library page "Charter" to the folder as "CLAUDE.md"
- **THEN** A4 says "CLAUDE.md" already exists, and `CLAUDE.md` is unchanged

#### Scenario: A path outside the folder is refused
- **WHEN** the user chooses New file in folder and enters "../notes.md"
- **THEN** A4 refuses the path, and no file is created

#### Scenario: The first letter
- **GIVEN** the open folder has no `.agents` folder
- **WHEN** the user chooses New letter
- **THEN** `.agents/letters/` is created with the new draft inside it
