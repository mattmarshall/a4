# served-library Specification

## Purpose
Lets an author keep a page library as Markdown files on their own machine,
served by `a4 serve` to the app on localhost, so agents, editors, and any
browser share one library without a page reaching a server elsewhere.

## Requirements

### Requirement: Serving a library
`a4 serve <folder> [--port <n>] [--origin <url>]` SHALL serve the library in
`<folder>`, creating it if it's missing, on port 4320 unless `--port` says
otherwise. It SHALL print the address it serves and its connect link, run
until stopped, and exit 2 when the folder can't be used or the port is taken.

#### Scenario: Starting the server
- **WHEN** the author runs `a4 serve ~/a4-library`
- **THEN** it prints `http://127.0.0.1:4320` and a link that starts with `https://a4.marsh.build/#serve=`, and keeps running

### Requirement: The files are the pages
A served page SHALL be the file `<folder>/pages/<name>.md`, holding exactly
the page's text, and a trashed page a file in `<folder>/trash/`. Names follow
the browser library's rules. A file written on disk SHALL be the page's text
the next time it is read.

#### Scenario: A page made in the app
- **WHEN** the author creates the page "Brief" on the served library and types "Ship Friday."
- **THEN** `<folder>/pages/Brief.md` holds exactly "Ship Friday." once the save completes

### Requirement: Loopback only
`a4 serve` SHALL listen only on the loopback address 127.0.0.1. It SHALL
refuse, with status 403 and without reading or writing a page, any request
whose `Host` isn't that address or `localhost` with the port it serves.

#### Scenario: A rebinding attempt
- **WHEN** a request reaches the server with `Host: attacker.example:4320`
- **THEN** it is refused with 403, and no page is read or written

### Requirement: Origin and token
Every request SHALL carry the library's token and come from an allowed
origin: `https://a4.marsh.build` and any `--origin`. Others SHALL be refused,
with status 401 or 403 and nothing read or written. The token is 32 random
bytes in `<folder>/.a4-serve-token`, readable only by its owner and reused
across runs. `--new-token` replaces it.

#### Scenario: The wrong token
- **WHEN** a request from `https://a4.marsh.build` carries a token that isn't the library's
- **THEN** it is refused with 401, and no page is read

#### Scenario: Another site
- **WHEN** a page on `https://example.com` sends a request with the right token
- **THEN** it is refused with 403, and no page is read

### Requirement: The protocol
Each library operation (list, read, create, create unique, write, rename,
trash, list trash, restore, purge) SHALL be a POST to
`/a4.v1.PageStoreService/<Method>` with an `a4.v1` protobuf request and
response. A store error SHALL come back as an `a4.v1.StoreFailure` with the
same code, so the app sees the same errors as from the browser's store.

#### Scenario: A stale write
- **GIVEN** a served page was changed on disk after the app read it
- **WHEN** the app saves with the revision it read
- **THEN** it gets a conflict, as it would from the browser's store, and both versions are kept

### Requirement: The contract
The served store, and the app's store talking to a running `a4 serve`, SHALL
both pass the library contract tests unchanged.

#### Scenario: The suites
- **WHEN** the tests run
- **THEN** the library contract suites for the served folder and for the store over HTTP pass

### Requirement: The connect link
The connect link SHALL be the app's origin with the fragment
`serve=127.0.0.1:<port>.<token>`, so neither the address nor the token reaches
a4.marsh.build. Opening it SHALL switch the app to the served library,
remember the address and token in this browser, and remove the fragment.

#### Scenario: Connecting
- **WHEN** the author opens the link `a4 serve` printed
- **THEN** the Pages panel shows the served library's pages, and the address bar no longer shows the token

### Requirement: Switching libraries
The Pages panel SHALL offer a switch between this browser's library and the
served library. On the served library, every library action SHALL work
against it. Switching back SHALL show this browser's library as it was, with
the pages that were open there.

#### Scenario: Back to this browser
- **GIVEN** "Notes" was open in this browser's library, and the author switched to the served library and opened "Brief"
- **WHEN** they switch back to this browser's library
- **THEN** its pages are unchanged and "Notes" is open again

### Requirement: Drafts stay in their library
Unsaved edits SHALL be kept for each library separately. A draft made on the
served library SHALL save only into the served library, and a draft made in
this browser's library only into it.

#### Scenario: The server stops during an edit
- **GIVEN** the author typed on the served page "Brief", and `a4 serve` stopped before the save
- **WHEN** they switch to this browser's library, and later restart `a4 serve` and switch back
- **THEN** this browser's pages are untouched, and the edit to "Brief" is recovered and saved to the served library

### Requirement: When the server is down
Starting on, or switching to, the served library while `a4 serve` can't be
reached SHALL say that it isn't running at its address, give the command to
start it, and show this browser's library. Nothing in this browser's library
SHALL change.

#### Scenario: Starting while the server is stopped
- **GIVEN** the author last used the served library, and `a4 serve` isn't running
- **WHEN** they open A4
- **THEN** A4 says `a4 serve` isn't running at 127.0.0.1:4320, and shows this browser's library

### Requirement: Changes on disk show up
While the served library is shown in a visible tab, the app SHALL notice
pages added, removed, or changed on disk within 5 seconds. An open page with
no unsaved edits SHALL show the new text. One with unsaved edits SHALL keep
both versions, as a conflict does.

#### Scenario: An agent writes a page
- **GIVEN** the served page "Brief" is open with no unsaved edits
- **WHEN** an agent writes new text to `<folder>/pages/Brief.md`
- **THEN** within 5 seconds the sheet shows the new text

### Requirement: Disconnecting
Disconnect SHALL forget the served library's address and token in this
browser and switch to this browser's library. The served library's files
SHALL stay as they are.

#### Scenario: Disconnecting
- **WHEN** the author chooses Disconnect
- **THEN** the Pages panel shows this browser's library, a reload doesn't reconnect, and `<folder>/pages/` is unchanged
