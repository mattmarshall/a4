# Spec Delta

## ADDED Requirements

### Requirement: Export all pages
The system SHALL download every page in the library as one `.zip` file named
`a4-pages-<YYYY-MM-DD>.zip`. The archive SHALL contain a folder
`a4-pages-<YYYY-MM-DD>/` holding one `<page name>.md` file per page, whose
content is exactly the page text and whose modified time is the page's.
Trashed pages SHALL NOT be included.

#### Scenario: Exporting a library
- **GIVEN** the library holds pages "Brief" and "Charter" and the trash holds "Old"
- **WHEN** the user chooses Export all on 2026-11-23
- **THEN** `a4-pages-2026-11-23.zip` downloads, containing `a4-pages-2026-11-23/Brief.md` and `a4-pages-2026-11-23/Charter.md` with their exact text, and no file for "Old"

### Requirement: Export includes unsaved edits
Before building the archive, the system SHALL save pending edits to the open
pages, so the export matches the text on screen.

#### Scenario: Exporting right after typing
- **GIVEN** the user typed on page "Brief" less than 600 ms ago
- **WHEN** the user chooses Export all
- **THEN** `Brief.md` in the archive contains the text just typed

### Requirement: Portable archive
The archive SHALL be a standard zip readable by common tools, with UTF-8 file
names, so page names with accented or non-Latin characters are preserved.

#### Scenario: Non-Latin names
- **GIVEN** a page named "Café brief · 漢字"
- **WHEN** the archive is extracted with a standard unzip tool
- **THEN** the extracted file is named "Café brief · 漢字.md" and holds the page text
