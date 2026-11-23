# Spec Delta

## ADDED Requirements

### Requirement: Import pages from a zip
The system SHALL let the user choose a `.zip` file and SHALL create a page for
every `.md` or `.txt` file in it, named after the file without its extension
or folder path. Imported text SHALL be normalized like pasted text (CRLF and CR
to LF, tabs to two spaces, a leading byte-order mark removed).

#### Scenario: Importing an export from another browser
- **GIVEN** an archive containing `a4-pages-2026-11-23/Brief.md` and `a4-pages-2026-11-23/Charter.md`
- **WHEN** the user imports it into an empty library
- **THEN** pages "Brief" and "Charter" exist with the files' text

#### Scenario: Plain text and Windows line endings
- **GIVEN** an archive containing `notes/handoff.txt` with CRLF line endings and a tab
- **WHEN** the user imports it
- **THEN** a page "handoff" exists whose text uses LF line endings and two spaces instead of the tab

### Requirement: Import never overwrites
Importing SHALL NOT change any existing page. A file whose page name matches an
existing page (ignoring case) and whose normalized text is identical SHALL be
skipped as unchanged. A file whose name matches but whose text differs SHALL be
imported under a unique name. Pages created earlier in the same import count
as existing pages.

#### Scenario: Re-importing your own export
- **GIVEN** the library holds "Brief" and "Charter", exported to a zip and unchanged since
- **WHEN** the user imports that zip
- **THEN** no pages are created and both files are reported as unchanged

#### Scenario: Same name, different text
- **GIVEN** the library holds "Brief" with text "v1"
- **WHEN** the user imports an archive whose `Brief.md` holds "v2"
- **THEN** "Brief" still holds "v1" and a new page "Brief 2" holds "v2"

#### Scenario: Duplicates inside one archive
- **GIVEN** an archive with `a/Brief.md` holding "x", `b/Brief.md` holding "x", and `c/Brief.md` holding "y"
- **WHEN** the user imports it into an empty library
- **THEN** "Brief" holds "x", "Brief 2" holds "y", and one file is reported as unchanged

### Requirement: Import skips non-page entries
The import SHALL ignore folder entries without counting them, and SHALL skip
and count as skipped each of the following: hidden files (names starting with
a period); files under `__MACOSX/`; files other than `.md` and `.txt`; files
containing NUL bytes; encrypted entries; entries that are corrupt or whose
checksum does not match; and files larger than 1 MB uncompressed.

#### Scenario: Archive zipped by macOS Finder
- **GIVEN** a Finder-made archive containing `pages/Brief.md`, `__MACOSX/pages/._Brief.md`, `pages/.DS_Store`, and `pages/logo.png`
- **WHEN** the user imports it
- **THEN** only "Brief" is created and three entries are reported as skipped

### Requirement: Import limits
Before inflating any entry, the system SHALL reject an archive that is not a
valid zip, uses Zip64, holds more than 5,000 entries, or declares more than
50 MB of uncompressed data in total, and SHALL leave the library unchanged
with an explanatory message.

#### Scenario: Not a zip
- **WHEN** the user chooses a file that is not a zip archive
- **THEN** an error says the file is not a zip archive and no page is created

### Requirement: Import report
After an import, the system SHALL tell the user how many pages were imported,
how many were renamed to avoid a clash, how many were unchanged, and how many
entries were skipped.

#### Scenario: Mixed archive
- **WHEN** an import creates 3 pages, 1 of them renamed, finds 2 unchanged, and skips 4 entries
- **THEN** the message reports 3 imported (1 renamed), 2 unchanged, and 4 skipped
