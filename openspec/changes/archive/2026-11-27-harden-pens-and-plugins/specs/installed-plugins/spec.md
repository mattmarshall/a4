## MODIFIED Requirements

### Requirement: Model files for installed plugins
An installed plugin's model files SHALL be downloaded only after the author
asks, with the download size shown first. They SHALL come from the URLs in
the signed manifest, be checked against their digests when they're
downloaded and each time the plugin starts, and be kept for later sessions.
Checking whether a plugin is ready SHALL NOT read or hash a file this tab
has already checked.

#### Scenario: First use of an installed overlay with a model
- **WHEN** the author turns on the lens of an installed overlay that needs a 12 MB model
- **THEN** they are told the download size and asked before anything is downloaded

#### Scenario: Listing a plugin again
- **GIVEN** an installed overlay's 38 MB of model files were checked when they downloaded in this tab
- **WHEN** the author installs another plugin, and the Models section checks every plugin again
- **THEN** the overlay shows as ready, and none of its 38 MB is read or hashed again

#### Scenario: A file that changed while stored
- **GIVEN** an installed overlay's stored model file was changed outside A4 after this tab checked it
- **WHEN** the overlay next starts
- **THEN** it doesn't start, and the author is told to download its model files again

### Requirement: Removing a plugin
Remove SHALL delete an installed plugin's code, its downloaded files, its
pinned key, and its source URL, and turn off any lens it provides. It SHALL
stop the plugin, closing its sandbox even if the sandbox is still starting.
Pages a pen created SHALL remain.

#### Scenario: Removing a pen after using it
- **GIVEN** Hard wrap created "Notes (Hard wrap)"
- **WHEN** the author removes Hard wrap
- **THEN** Hard wrap is no longer listed, and "Notes (Hard wrap)" is still in the library

#### Scenario: Removing a plugin while it starts
- **GIVEN** an installed overlay's sandbox is starting for its first score
- **WHEN** the author removes the overlay before the start finishes
- **THEN** the sandbox is closed as soon as the start finishes, the score fails without tinting the page, and nothing of the overlay keeps running

## ADDED Requirements

### Requirement: Every tab sees the same plugins
An install, update, or removal in one tab SHALL reach every other open A4
tab in this browser within 2 seconds, without a reload. The other tabs SHALL
list the new plugin, run the new version, or stop the removed plugin as the
tab that removed it does: its lens turned off, its running pen canceled,
and its credentials and consent forgotten.

#### Scenario: Installing in another tab
- **GIVEN** two A4 tabs are open, and neither has an installed plugin
- **WHEN** the author installs Word length in the first tab
- **THEN** within 2 seconds the second tab lists Word length and offers its lens

#### Scenario: Removing in another tab
- **GIVEN** Word length's lens is on in the second tab
- **WHEN** the author removes Word length in the first tab
- **THEN** within 2 seconds the second tab no longer lists Word length, its lens is off, and its sandbox is closed

#### Scenario: Updating in another tab
- **GIVEN** Hard wrap 1.0.0 is installed, and both tabs list it
- **WHEN** the author updates Hard wrap to 1.1.0 in the first tab
- **THEN** within 2 seconds the second tab lists Hard wrap 1.1.0, and its next run there runs 1.1.0
