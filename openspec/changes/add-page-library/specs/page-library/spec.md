# Spec Delta

## Purpose

Lets the author keep any number of A4 pages in the browser and move between
them: browse, search, create, open, rename, duplicate, trash, restore, and
delete, without ever losing a page by accident.

## ADDED Requirements

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
together with its save status.

#### Scenario: Renaming from the header
- **WHEN** the user edits the page name in the header and presses Enter
- **THEN** the page is renamed and the library shows the new name
