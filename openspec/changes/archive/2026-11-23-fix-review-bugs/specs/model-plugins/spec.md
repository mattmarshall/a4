# Spec Delta

## ADDED Requirements

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
