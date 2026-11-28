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
response, and so SHALL `GetLibrary`, which returns the library's id and
protocol version. A store error SHALL come back as an `a4.v1.StoreFailure`
with the code the browser's store would give and a typed detail: a
conflict's two revisions, or an unreadable file's reason.

#### Scenario: A stale write
- **GIVEN** a served page was changed on disk after the app read it
- **WHEN** the app saves with the revision it read
- **THEN** it gets a conflict, as it would from the browser's store, and both versions are kept

#### Scenario: A file that isn't UTF-8
- **GIVEN** a program wrote `<folder>/pages/Cafe.md` in Latin-1
- **WHEN** the author opens "Cafe" on the served library
- **THEN** A4 says “Cafe” isn't UTF-8 text, as it would for a folder file, and the file's bytes are unchanged

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

### Requirement: Connecting by hand
Connecting from the Pages panel's Connect form SHALL reach the server before
it remembers anything. If A4 can use it, the address and token SHALL be
remembered and its pages shown. If A4 can't, the form SHALL stay open and
say why and what to do, for each reason in "When the server is down". The
address and token SHALL NOT be remembered, and the library shown SHALL NOT
change.

#### Scenario: Connecting by hand
- **GIVEN** `a4 serve` is running at 127.0.0.1:4320
- **WHEN** the author enters its address and token in the Connect form and chooses Connect
- **THEN** the form closes, the Pages panel shows the served library's pages, and a reload connects to it again

#### Scenario: Connecting while the server is stopped
- **GIVEN** no `a4 serve` is running at 127.0.0.1:4320
- **WHEN** the author enters that address and a token in the Connect form and chooses Connect
- **THEN** the form stays open and says `a4 serve` isn't running at 127.0.0.1:4320 and to start it, this browser's library stays shown, and after a reload the Pages panel still offers Connect a4 serve…

#### Scenario: A mistyped token
- **GIVEN** `a4 serve` is running at 127.0.0.1:4320
- **WHEN** the author enters its address with a token it refuses, and chooses Connect
- **THEN** the form stays open and says the server refused the token, with the address and token still filled in to correct, and nothing is remembered

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
Starting on, switching to, or connecting to the served library while A4
can't use it SHALL show this browser's library, change nothing in it, and
say why, with what to do. A token refused while it's shown SHALL be noticed
within 5 seconds.
- not running: start it, and for a page not served from
  `https://a4.marsh.build`, with `--origin` for this page;
- refused this browser's token: open the link it printed again;
- another protocol version (see "Matching versions");
- an answer A4 can't read.

#### Scenario: Starting while the server is stopped
- **GIVEN** the author last used the served library, and `a4 serve` isn't running
- **WHEN** they open A4
- **THEN** A4 says `a4 serve` isn't running at 127.0.0.1:4320, and shows this browser's library

#### Scenario: A new token
- **GIVEN** the author connected to `a4 serve`, and then restarted it with `--new-token`
- **WHEN** they switch to the served library
- **THEN** A4 says the server refused this browser's token and to open the link it printed again, rather than that it isn't running

#### Scenario: A new token while the library is shown
- **GIVEN** the served library is shown in a visible tab
- **WHEN** the author restarts `a4 serve` on the same folder with `--new-token`
- **THEN** within 5 seconds A4 shows this browser's library and says the server refused this browser's token and to open the link it printed again

#### Scenario: A development page a4 serve doesn't allow
- **GIVEN** A4 is served from http://localhost:5173, and `a4 serve` runs without `--origin http://localhost:5173`
- **WHEN** the author connects with the Connect form
- **THEN** the form says `a4 serve` isn't running at 127.0.0.1:4320, or doesn't allow this page, and names `--origin http://localhost:5173`

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

### Requirement: A library's identity
`a4 serve` SHALL keep an id for each library folder in `<folder>/.a4-library`.
It's made the first time the folder is served, and is the same across
restarts and `--new-token`. The app SHALL learn the id from `GetLibrary`
before it shows the served library, and SHALL keep its drafts, tab messages,
and remembered open pages by that id. While shown, another library behind
the same connection SHALL be noticed within 5 seconds and shown, with a
notice; the first keeps its edits by its id.

#### Scenario: A restart with a new token
- **GIVEN** "Brief" was open on the served library
- **WHEN** the author restarts `a4 serve` on the same folder with `--new-token`, and opens the new link
- **THEN** the library's id is unchanged, and "Brief" is open again

#### Scenario: Open pages belong to their library
- **GIVEN** "Brief" was open on the library served from `~/notes` at 127.0.0.1:4320
- **WHEN** the author serves `~/other`, which has no "Brief", at 127.0.0.1:4320, and connects to it
- **THEN** A4 opens a page of `~/other`, and "Brief" opens again when `~/notes` is connected again

#### Scenario: Another folder served behind the same link
- **GIVEN** the library served from `~/notes` is shown in a visible tab, with an unsaved edit to "Brief" that couldn't be saved because `a4 serve` stopped
- **WHEN** the author serves a copy of `~/notes` that kept its token but not its `.a4-library`, at the same address
- **THEN** within 5 seconds A4 says another library is now served there and shows its pages, the edit isn't saved into the copy, and it is recovered into `~/notes` when that folder is served and connected again

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
`GetLibrary` SHALL return the protocol version the server speaks. The app
SHALL show the served library only when that version is its own, and SHALL
notice another version within 5 seconds while it's shown. A server that
doesn't answer `GetLibrary` SHALL count as older. Refused for its version,
the app SHALL read and write nothing there, and SHALL say what to do:
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

#### Scenario: An a4 serve upgraded while the library is shown
- **GIVEN** the served library is shown in a visible tab
- **WHEN** the author restarts `a4 serve` on the same folder from a checkout with a newer protocol version
- **THEN** within 5 seconds A4 says to reload A4, shows this browser's library, and sends that server no further page operation
