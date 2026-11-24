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

#### Scenario: The folder as sessions see it
- **WHEN** the core contract test suite runs against the folder backend as autosave sessions see it (sheet text mapped onto the file on disk)
- **THEN** it passes: text with no tab, carriage return, or leading byte-order mark round-trips exactly, and each revision is that of the file on disk

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

### Requirement: Page listings
A list SHALL return each page once, in no guaranteed order. A library
backend's list SHALL be complete; the folder backend's list SHALL stop where
the folder scan stops. Each page's size SHALL be its stored size in bytes,
and its modified time the time of its last write as the storage records it.

#### Scenario: A folder file's size is its size on disk
- **GIVEN** a folder file of 120 bytes with CRLF line endings
- **WHEN** autosave sessions list or read it
- **THEN** its size is 120, not the length of its sheet text

#### Scenario: List order is not part of the contract
- **WHEN** pages "b", "a", and "c" are created in that order and the storage lists entries in another order
- **THEN** the list returns each of the three pages exactly once

### Requirement: Name claims are serialized across tabs
Each library backend, including the localStorage fallback, SHALL check and
claim a name while holding it across tabs, ignoring case, when it creates a
page under a unique name, renames a page, or restores a page from the trash.
A rename SHALL hold both the old and the new name. Two tabs SHALL never both
claim the same name. Without cross-tab locking in the browser, these
operations SHALL behave as they do within one tab.

#### Scenario: Two tabs create a page at once
- **WHEN** two tabs each create a page under a unique name based on "Untitled" at the same time
- **THEN** one page is named "Untitled" and the other "Untitled 2", and neither operation fails

#### Scenario: Rename races a create
- **GIVEN** one tab renames "Notes" to "Brief" while another tab creates a page named "Brief"
- **WHEN** both finish
- **THEN** exactly one page is named "Brief", the other operation fails with a name-taken error, and no text is lost

#### Scenario: Restore races a create
- **GIVEN** the trash holds a page named "Brief"
- **WHEN** it is restored while another tab creates a page under a unique name based on "Brief"
- **THEN** the library ends with "Brief" and "Brief 2", one of each text

### Requirement: Renames never lose a page
A rename to a case variant of the same name SHALL keep the page and its text
on storage that ignores case. An interrupted rename SHALL NOT lose the page:
it MAY leave the text under both names, or under a temporary name that the
library lists, but never under no name.

#### Scenario: Case-only rename on storage that ignores case
- **GIVEN** storage that treats "notes" and "Notes" as the same name, and a page "notes"
- **WHEN** the page is renamed to "Notes"
- **THEN** the library holds one page, named "Notes", with the page's text

#### Scenario: Interrupted rename
- **GIVEN** a rename from "Notes" to "Brief" fails after the new name was written
- **WHEN** the library is listed
- **THEN** the page appears under "Brief", and possibly also under "Notes", with the same text in both
