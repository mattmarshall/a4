# page-library Specification

## Purpose
Lets the author keep any number of A4 pages in the browser and move between
them: browse, search, create, open, rename, duplicate, trash, restore, and
delete, without ever losing a page by accident.

## Requirements

### Requirement: Browse pages
The system SHALL show a library listing every saved page by name, sorted by
most recently modified first, with each page's last-modified time, and SHALL
mark the pages that are open.

#### Scenario: Listing pages
- **GIVEN** the library holds pages "Charter" (modified today) and "Handoff" (modified yesterday)
- **WHEN** the user opens the library
- **THEN** "Charter" is listed above "Handoff" and each shows when it was modified

### Requirement: Search pages
The library SHALL filter the list by a case-insensitive substring of the page
name as the user types.

#### Scenario: Filtering
- **GIVEN** pages "Agent Charter", "Handoff", and "charter notes"
- **WHEN** the user types "charter" in the search box
- **THEN** only "Agent Charter" and "charter notes" are listed

### Requirement: Create pages
The system SHALL create a new page from a blank sheet or from any template and
open it. New pages SHALL get a unique default name ("Untitled", or the
template name) with a numeric suffix when that name is taken.

#### Scenario: Two blank pages
- **GIVEN** a page named "Untitled" exists
- **WHEN** the user creates a blank page
- **THEN** a page named "Untitled 2" is created and opened

### Requirement: Open pages
Selecting a page in the library SHALL open it on the sheet after saving any
pending edits to the page that was open.

#### Scenario: Switching pages keeps edits
- **GIVEN** the user has just typed on page "One"
- **WHEN** the user immediately opens page "Two"
- **THEN** "Two" is shown and reopening "One" shows the text that was typed

### Requirement: Rename pages
The user SHALL be able to rename a page. Names SHALL be 1 to 80 characters,
SHALL NOT contain / \ : * ? " < > | or control characters, SHALL NOT start with
a period, and SHALL be unique ignoring case. Invalid or duplicate names SHALL
be rejected with a message and leave the page unchanged.

#### Scenario: Duplicate name rejected
- **GIVEN** pages "Brief" and "Notes" exist
- **WHEN** the user renames "Notes" to "brief"
- **THEN** the rename is rejected with a message and the page is still named "Notes"

### Requirement: Duplicate pages
The user SHALL be able to duplicate a page into a new page named "<name> copy"
(with a numeric suffix when taken) holding the same text.

#### Scenario: Duplicating
- **WHEN** the user duplicates "Brief"
- **THEN** a page "Brief copy" with the same text appears in the library

### Requirement: Trash and restore
Deleting a page SHALL move it to the trash rather than erase it. The trash
SHALL list deleted pages with when they were deleted and SHALL let the user
restore a page (under a unique name) or delete it permanently after
confirmation. Emptying the trash SHALL require confirmation.

#### Scenario: Restoring a deleted page
- **GIVEN** the user deleted page "Brief"
- **WHEN** the user restores it from the trash
- **THEN** "Brief" is back in the library with its text

#### Scenario: Deleting an open page
- **GIVEN** page "Brief" is open on the sheet
- **WHEN** the user moves "Brief" to the trash
- **THEN** the sheet switches to another page, or to a new blank page if none remain

### Requirement: First run
When the library is empty and there is nothing to migrate, the system SHALL
create a "Welcome" page holding the welcome text and open it.

#### Scenario: Fresh browser
- **GIVEN** a browser with no A4 data
- **WHEN** the user opens the workbench
- **THEN** the library holds one page, "Welcome", and it is open

### Requirement: Migration from single-page storage
On first load with the library, text saved by earlier versions in the page A
and page B slots SHALL be imported as pages, named after their first non-blank
line. The original slot text SHALL NOT be deleted until the import succeeds.

#### Scenario: Upgrading
- **GIVEN** an earlier version saved page A text starting with "HANDOFF · Billing export"
- **WHEN** the user opens the new version
- **THEN** the library contains a page named "HANDOFF · Billing export" with that text

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
