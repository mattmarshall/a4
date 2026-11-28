## MODIFIED Requirements

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
