## MODIFIED Requirements

### Requirement: Typed page store contract
All page persistence SHALL go through typed contracts with typed errors for
not found, name taken, invalid name, conflict, and storage unavailable. Every
backend SHALL implement the core operations: list, read, create, and write.
Library backends SHALL also implement rename, trash, list trash, restore, and
purge. Application code SHALL NOT depend on a specific backend.

**What a list returns:**
- A list SHALL return each page once, in no guaranteed order.
- A library backend's list SHALL be complete. The folder backend's list
  SHALL stop where the folder scan stops.
- Each page's size SHALL be its stored size in bytes.
- Each page's modified time SHALL be the time of its last write, as the
  storage records it.

#### Scenario: Swapping backends
- **WHEN** the same core contract test suite runs against every backend, including the folder backend
- **THEN** every backend passes it without backend-specific changes to the tests

#### Scenario: Library operations
- **WHEN** the library contract test suite runs against the OPFS, localStorage, and in-memory backends
- **THEN** each passes it without backend-specific changes to the tests

#### Scenario: The folder as sessions see it
- **WHEN** the core contract test suite runs against the folder backend as autosave sessions see it (sheet text mapped onto the file on disk)
- **THEN** it passes: text with no tab, carriage return, or leading byte-order mark round-trips exactly, and each revision is that of the file on disk

#### Scenario: A folder file's size is its size on disk
- **GIVEN** a folder file of 120 bytes with CRLF line endings
- **WHEN** autosave sessions list or read it
- **THEN** its size is 120, not the length of its sheet text

#### Scenario: List order is not part of the contract
- **WHEN** pages "b", "a", and "c" are created in that order and the storage lists entries in another order
- **THEN** the list returns each of the three pages exactly once

## ADDED Requirements

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
