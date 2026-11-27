## MODIFIED Requirements

### Requirement: The protocol
Each library operation (list, read, create, create unique, write, rename,
trash, list trash, restore, purge) SHALL be a POST to
`/a4.v1.PageStoreService/<Method>` with an `a4.v1` protobuf request and
response, and so SHALL `GetLibrary`, which returns the library's id and the
protocol version the server speaks.

A store error SHALL come back as an `a4.v1.StoreFailure` with the same code
and a typed detail, so the app sees the same errors as from the browser's
store:
- a conflict carries the revision the write expected and the stored one;
- an unreadable file carries its reason, too large or not UTF-8.

#### Scenario: A stale write
- **GIVEN** a served page was changed on disk after the app read it
- **WHEN** the app saves with the revision it read
- **THEN** it gets a conflict, as it would from the browser's store, and both versions are kept

#### Scenario: A file that isn't UTF-8
- **GIVEN** a program wrote `<folder>/pages/Cafe.md` in Latin-1
- **WHEN** the author opens "Cafe" on the served library
- **THEN** A4 says “Cafe” isn't UTF-8 text, as it would for a folder file, and the file's bytes are unchanged

### Requirement: Drafts stay in their library
Unsaved edits SHALL be kept for each library separately, and a served
library's SHALL be kept by its id, not its address. A draft made on the
served library SHALL save only into that library, and a draft made in this
browser's library only into it.

#### Scenario: The server stops during an edit
- **GIVEN** the author typed on the served page "Brief", and `a4 serve` stopped before the save
- **WHEN** they switch to this browser's library, and later restart `a4 serve` and switch back
- **THEN** this browser's pages are untouched, and the edit to "Brief" is recovered and saved to the served library

#### Scenario: Another folder on the same port
- **GIVEN** the author typed on "Brief" in a library served from `~/notes` at 127.0.0.1:4320, and `a4 serve` stopped before the save
- **WHEN** they serve `~/other` at 127.0.0.1:4320 instead, and connect to it
- **THEN** the edit isn't recovered into `~/other`, and it is recovered into `~/notes` when that folder is served and connected again

### Requirement: When the server is down
Starting on, or switching to, the served library while A4 can't use it SHALL
show this browser's library, change nothing in it, and say why, with what to
do:
- `a4 serve` isn't running at its address: start it;
- it refused this browser's token: open the link it printed again;
- it speaks another protocol version (see "Matching versions");
- its answer couldn't be read.

#### Scenario: Starting while the server is stopped
- **GIVEN** the author last used the served library, and `a4 serve` isn't running
- **WHEN** they open A4
- **THEN** A4 says `a4 serve` isn't running at 127.0.0.1:4320, and shows this browser's library

#### Scenario: A new token
- **GIVEN** the author connected to `a4 serve`, and then restarted it with `--new-token`
- **WHEN** they switch to the served library
- **THEN** A4 says the server refused this browser's token and to open the link it printed again, rather than that it isn't running

## ADDED Requirements

### Requirement: A library's identity
`a4 serve` SHALL keep an id for each library folder in `<folder>/.a4-library`.
It's made the first time the folder is served, and is the same across
restarts and `--new-token`. The app SHALL learn the id from `GetLibrary`
before it shows the served library. The app SHALL keep the served library's
drafts, tab messages, and remembered open pages by that id.

#### Scenario: A restart with a new token
- **GIVEN** "Brief" was open on the served library
- **WHEN** the author restarts `a4 serve` on the same folder with `--new-token`, and opens the new link
- **THEN** the library's id is unchanged, and "Brief" is open again

#### Scenario: Open pages belong to their library
- **GIVEN** "Brief" was open on the library served from `~/notes` at 127.0.0.1:4320
- **WHEN** the author serves `~/other`, which has no "Brief", at 127.0.0.1:4320, and connects to it
- **THEN** A4 opens a page of `~/other`, and "Brief" opens again when `~/notes` is connected again

### Requirement: Adopting what was kept by address
Drafts and open pages the app kept for a served library by its address,
before libraries had ids, SHALL be adopted once, by the first library reached
at that address, and then no longer kept by address. A draft whose page
changed since the draft was made SHALL be saved as a copy, never over the
page.

#### Scenario: The first connect after the update
- **GIVEN** A4 kept a draft of "Brief" for 127.0.0.1:4320 before libraries had ids, and the folder served there still has "Brief" as the draft started from
- **WHEN** the author connects to that server after the update
- **THEN** the draft is recovered and saved to "Brief", and nothing is kept by the address afterwards

#### Scenario: A draft from another folder
- **GIVEN** A4 kept a draft of "Brief" for 127.0.0.1:4320, and the folder now served there has a different "Brief"
- **WHEN** the author connects to it
- **THEN** the draft is saved as a copy beside "Brief", and "Brief" is unchanged

### Requirement: Matching versions
`GetLibrary` SHALL return the protocol version the server speaks, and the
app SHALL show the served library only when that version is its own. A
server that doesn't answer `GetLibrary`, from an older checkout, SHALL be
treated as an older version. Refused for its version, the app SHALL read and
write nothing on that server, and SHALL say what to do:
- for an older server: update the A4 checkout and restart `a4 serve`;
- for a newer server: reload A4.

#### Scenario: An older a4 serve
- **GIVEN** the author runs `a4 serve` from a checkout older than the protocol version this A4 speaks
- **WHEN** they open its connect link
- **THEN** A4 says `a4 serve` at its address is older than this A4 and to update the checkout and restart it, shows this browser's library, and the server receives no page operation

#### Scenario: A newer a4 serve
- **GIVEN** `a4 serve` speaks a newer protocol version than the open A4 tab
- **WHEN** the author switches to the served library
- **THEN** A4 says to reload A4, and shows this browser's library
