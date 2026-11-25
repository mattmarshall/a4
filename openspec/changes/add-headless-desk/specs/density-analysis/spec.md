# Spec Delta

## MODIFIED Requirements

### Requirement: Live analysis on device
The system SHALL recompute every metric within one second after the page text
changes, without an explicit action, and SHALL compute all metrics on the
device, in the browser or in the local `a4` command line, without sending page
text over the network.

#### Scenario: Metrics follow typing
- **WHEN** the user types a sentence on an empty page
- **THEN** within one second the fill, ink, and token metrics are greater than zero

#### Scenario: No text leaves the device
- **WHEN** the user edits the page
- **THEN** no network request contains any part of the page text

#### Scenario: The command line computes locally
- **WHEN** the user runs `a4 lint` on a folder of context files
- **THEN** every metric is computed on the device and no network request is made
