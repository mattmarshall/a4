# page-storage Specification

## Purpose
Defines how pages are stored: one typed contract that every storage backend
implements, the Origin Private File System layout and file format used by
default, how a backend is chosen, and how tabs learn about each other's
changes.

## Requirements

### Requirement: Typed page store contract
All page persistence SHALL go through typed contracts with typed errors for
not found, name taken, invalid name, conflict, and storage unavailable. Every
backend SHALL implement the core operations: list, read, create, and write.
Library backends SHALL also implement rename, trash, list trash, restore, and
purge. Application code SHALL NOT depend on a specific backend.

#### Scenario: Swapping backends
- **WHEN** the same core contract test suite runs against every backend, including the folder backend
- **THEN** every backend passes it without backend-specific changes to the tests

#### Scenario: Library operations
- **WHEN** the library contract test suite runs against the OPFS, localStorage, and in-memory backends
- **THEN** each passes it without backend-specific changes to the tests

### Requirement: Content revisions and conflicts
Every read and write SHALL return a revision derived from the page content. A
write that names an expected revision SHALL fail with a conflict error, and
leave the stored page unchanged, when the stored content no longer matches
that revision.

#### Scenario: Stale write rejected
- **GIVEN** a tab read page "Brief" at revision R1 and another tab then saved new text
- **WHEN** the first tab writes "Brief" expecting R1
- **THEN** the write fails with a conflict error and the other tab's text is kept

#### Scenario: Identical content is not a conflict
- **GIVEN** two tabs saved the same text to "Brief"
- **WHEN** either writes again expecting the revision of that text
- **THEN** the write succeeds

### Requirement: OPFS layout
The default backend SHALL store pages in the Origin Private File System under
`a4/pages/<name>.md` and trashed pages under `a4/trash/<name>.md`, creating
the folders on first use. It SHALL ignore files that do not end in `.md`,
including browser temporary files.

#### Scenario: Creating a page writes a file
- **WHEN** the user creates a page named "Brief"
- **THEN** the OPFS file `a4/pages/Brief.md` exists

### Requirement: File content is the page
A page file SHALL contain exactly the page text as UTF-8, with no front matter
or added metadata, so the file can be handed to an agent unchanged.

#### Scenario: Byte-for-byte content
- **GIVEN** the page text "Purpose: brief the agent.\n"
- **WHEN** the page is saved
- **THEN** the file's content is exactly "Purpose: brief the agent.\n"

### Requirement: Atomic page writes
A page write SHALL either fully replace the file content or leave the previous
content intact; a failed or interrupted write SHALL NOT leave a truncated
page. Writes to the same page from different tabs SHALL be serialized.

#### Scenario: Interrupted write
- **GIVEN** a write fails partway through
- **WHEN** the page is read again
- **THEN** it holds the complete previous text

### Requirement: Backend selection
At startup the system SHALL use OPFS when the browser supports it, otherwise
browser local storage, otherwise in-memory storage, and SHALL show which
backend is active. When only in-memory storage is available, the UI SHALL warn
that pages will not survive a reload. Pages saved in local storage SHALL be
moved into OPFS once OPFS is available.

#### Scenario: No OPFS
- **GIVEN** a browser without OPFS writable files
- **WHEN** the user opens the workbench
- **THEN** pages are stored in local storage and the library shows that backend

#### Scenario: OPFS becomes available
- **GIVEN** pages were saved in local storage while OPFS was unavailable
- **WHEN** the workbench starts in a browser with OPFS
- **THEN** those pages appear in the library and are stored in OPFS

### Requirement: Persistent storage request
On the first edit in a session, the system SHALL request persistent storage
from the browser and SHALL show whether storage is persistent or
best-effort.

#### Scenario: Persistence granted
- **GIVEN** the browser grants persistent storage
- **WHEN** the user edits a page
- **THEN** the library footer shows that storage is persistent

### Requirement: Cross-tab change notification
When a tab changes the library (create, write, rename, trash, restore, or
purge), other open tabs SHALL refresh their library list. A tab with no unsaved
edits to an open page SHALL reload that page when another tab saves it.

#### Scenario: Edit in another tab
- **GIVEN** page "Brief" is open in two tabs and the second tab has no unsaved edits
- **WHEN** the first tab saves new text to "Brief"
- **THEN** the second tab shows the new text

### Requirement: Exact text round trip
Every backend SHALL return exactly the text it was given, including a leading
byte-order mark (U+FEFF), and the revision returned by a write SHALL equal the
revision of the next read. A backend SHALL refuse text that isn't well-formed
Unicode (a lone surrogate) with an invalid-text error, instead of storing a
changed version.

#### Scenario: A page that starts with a byte-order mark
- **GIVEN** a library page created with the text "﻿hello"
- **WHEN** the page is read and then written with the revision of that read
- **THEN** the read returns "﻿hello" and the write succeeds without a conflict

#### Scenario: A lone surrogate
- **WHEN** a page is created with text containing an unpaired U+D800
- **THEN** the store refuses it with an invalid-text error and stores nothing
