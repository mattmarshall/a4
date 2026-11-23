# fit-to-page Specification

## Purpose
Lets the author ask Claude to rewrite a page so it fits on one sheet and reads
as narrative. The author's own key is used only after they confirm each call,
and the result lands beside the original, never over it.

## Requirements

### Requirement: Author's own key
Fit to page SHALL use an Anthropic API key the author enters. The key SHALL be
held in memory for the current tab only. It SHALL NOT be written to storage,
page files, exports, the journal, or logs, and it SHALL be forgotten on reload
or when the author chooses Forget key.

#### Scenario: Reloading
- **GIVEN** the author entered a key and ran Fit to page
- **WHEN** they reload the app
- **THEN** the key is gone and the next Fit to page asks for it again

### Requirement: Consent per call
Each run SHALL ask the author to confirm first. The confirmation SHALL name
Anthropic (`api.anthropic.com`), the model, the page, and the number of
characters to send. The page text SHALL be sent directly from the browser to
that host and nowhere else.

#### Scenario: Confirming
- **WHEN** the author runs Fit to page on a 5,400-character page
- **THEN** the confirmation names api.anthropic.com, the model, the page name, and 5,400 characters, and nothing is sent until they confirm

### Requirement: Fit with repairs
A result SHALL fit when it lays out within the preset's rows, which is 60 on
Terminal. When it does not fit, the system SHALL ask the model again, saying
how many rows are over. It SHALL make at most 3 attempts in all, and if none
fits, it SHALL keep the attempt that uses the fewest rows and say by how many
rows it is over.

#### Scenario: Fits on the second attempt
- **GIVEN** the first attempt lays out to 64 rows and the second to 58
- **WHEN** Fit to page runs on the Terminal preset
- **THEN** the second attempt is the result and no third attempt is made

#### Scenario: Never fits
- **GIVEN** the three attempts lay out to 70, 66, and 63 rows
- **WHEN** Fit to page runs on the Terminal preset
- **THEN** the 63-row attempt is kept and the author is told it is over by 3 rows

### Requirement: Result beside the original
The result SHALL be saved as a new page named after the source with " (fit)"
appended, made unique if that name exists. It SHALL open in Compare as page B
with the source as page A, and the source page SHALL NOT change.

#### Scenario: Comparing the rewrite
- **WHEN** Fit to page finishes for the page "Incident brief"
- **THEN** a page "Incident brief (fit)" opens as B beside "Incident brief" as A, and "Incident brief" is unchanged

### Requirement: Failures and cancel
If the key is rejected, the network fails, the model declines, or the author
cancels, the system SHALL create no page and leave the source unchanged. It
SHALL show a message saying which of these happened.

#### Scenario: A rejected key
- **WHEN** Anthropic rejects the key
- **THEN** no page is created and the author is told the key was not accepted

#### Scenario: Cancel while writing
- **WHEN** the author cancels while the rewrite is streaming
- **THEN** the request is aborted and no page is created
