# model-plugins Specification

## Purpose
Defines one contract that any model plugs into, to read a sheet, score it, or
write a new one, and the host rules that keep the page's fit, the author's
work, and the page's privacy under A4's control rather than the model's.

## Requirements

### Requirement: Model cards
Every plugin SHALL describe itself with a model card. The card SHALL give an
id, a name, and the operations it supports. It SHALL also give the sheet views
it reads, the presets it supports, and where it runs (in the browser, a local
service, or a remote service). Finally, it SHALL say whether it sends page text
off the device and, if so, to which host.

#### Scenario: Listing plugins
- **WHEN** the author opens the list of models
- **THEN** each plugin shows its name, what it does, where it runs, and whether it sends page text off the device

### Requirement: Operations
The contract SHALL define four operations:
- **Encode**: a sheet to embeddings.
- **Score**: a sheet to per-cell planes and named scores.
- **Transform**: a sheet to a new sheet.
- **Generate**: source material to a new sheet.

The host SHALL invoke only operations a plugin's card declares.

#### Scenario: An undeclared operation
- **GIVEN** a plugin whose card declares only Score
- **WHEN** the host is asked to run Transform with it
- **THEN** the request is refused without contacting the plugin

### Requirement: Sheet views
A plugin SHALL receive the sheet in the views its card declares. The views are
text (the page text), grid (the sheet tensor), and pixels (the rendered page).
The text and grid views SHALL always describe the same page.

#### Scenario: A grid reader
- **GIVEN** a plugin whose card declares the grid view
- **WHEN** it is asked to score a page
- **THEN** it receives the page's grid and preset, and the grid decodes to the page text

### Requirement: Per-cell planes
A Score result SHALL return each plane as values over the scored grid's shape,
along with the text it was computed for. The host SHALL reject a plane whose
shape does not match that grid.

#### Scenario: A plane of the wrong shape
- **WHEN** a plugin returns a 60 × 79 plane for a 60 × 80 grid
- **THEN** the host rejects the result and reports the plugin's error

### Requirement: Host-enforced fit
For Transform and Generate, the host SHALL decide whether a result fits by
laying it out on the page's preset. A result fits when it uses no more rows
than the preset has, which is 60 on the Terminal preset. A plugin's own claim
that its output fits SHALL be ignored.

#### Scenario: A result that overflows
- **WHEN** a Transform returns text that lays out to 63 rows on the Terminal preset
- **THEN** the host marks the result as over by 3 rows

### Requirement: Model output never overwrites
Model output SHALL NOT change an existing page's text, and SHALL NOT change the
built-in analysis, verdict, or metrics. Transform and Generate results SHALL
become new pages, and Score results SHALL appear only as model lenses and
model summaries.

#### Scenario: A Transform result
- **WHEN** a Transform completes for the page "Brief"
- **THEN** "Brief" is unchanged and the result is saved as a new page

### Requirement: Privacy gate
A plugin whose card says it sends page text off the device SHALL run only after
the author confirms that specific call. The confirmation SHALL name the
destination host, the model, the page, and the number of characters sent.
Declining SHALL send nothing.

#### Scenario: Declining
- **WHEN** the author declines the confirmation for a remote plugin
- **THEN** no network request carrying page text is made and no page is created

#### Scenario: Consent is per call
- **GIVEN** the author confirmed one remote call
- **WHEN** they run the same plugin again
- **THEN** they are asked to confirm again

### Requirement: In-browser plugins stay on the device
A plugin whose card says it runs in the browser and keeps text on the device
SHALL make no network request carrying page text. If it needs model files, it
SHALL download them only after the author asks. It SHALL state the download
size first, and keep the files for later sessions.

#### Scenario: First use of a model
- **WHEN** the author first runs an in-browser plugin that needs a model
- **THEN** they are told the download size and asked before anything is downloaded

### Requirement: Bundled plugins only
The host SHALL run only plugins bundled with the application. It SHALL NOT load
plugin code from page content, imports, or URLs.

#### Scenario: A page that names a plugin
- **WHEN** an imported page's text contains a URL to a plugin script
- **THEN** no code is fetched or run from it

### Requirement: Worker isolation
In-browser plugins SHALL run off the main thread, so editing stays responsive
while a model works. Requests and results that cross into or out of the worker
SHALL be protobuf messages from the same versioned contract.

#### Scenario: Typing while scoring
- **WHEN** the author types while an in-browser plugin is scoring
- **THEN** each keystroke appears on the sheet without waiting for the scoring to finish

### Requirement: Failed plugins end their calls
If a plugin's worker fails to load, crashes, or sends a message that can't be
decoded, every call waiting on it SHALL end with an error within 1 second, and
the next call SHALL start a new worker.

#### Scenario: The worker crashes while scoring
- **GIVEN** the Semantic repetition plugin is scoring a page
- **WHEN** its worker crashes
- **THEN** the score call fails with an error within 1 second, and the next score starts a fresh worker

### Requirement: Fixed model cards
A plugin's card SHALL be fixed when the host registers it. Changing a card
object afterward SHALL NOT change what the host enforces, including whether
a call needs consent.

#### Scenario: Changing a card after registration
- **GIVEN** Fit to page is registered with a card that sends text off the device
- **WHEN** some code sets that card object's off-device flag to false
- **THEN** a Transform without consent is still refused

### Requirement: Validated results
The host SHALL reject a plugin result whose finding spans fall outside the
page text (start ≤ end ≤ text length) or whose plane depth isn't 1. Planes
SHALL be identified by plugin and plane name, so two planes from one plugin
don't replace each other.

#### Scenario: A span past the end of the text
- **WHEN** a plugin returns a finding span ending at 120 for a 100-character page
- **THEN** the host fails the call with an invalid-result error and nothing is selected
