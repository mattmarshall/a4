# Spec Delta

## ADDED Requirements

### Requirement: One set of signals
The verdict, the findings, and the state of each metric bar (ok, warn, or
bad) SHALL all come from one set of signals computed once per analysis. A bar
SHALL show warn or bad only when a finding about that metric is shown, and a
metric with no value (such as narrative share on a page too short to judge)
SHALL show as not applicable rather than 0.

#### Scenario: A short key-value page
- **GIVEN** a 3-line page of `key: value` lines
- **WHEN** it is analyzed
- **THEN** the Narrative bar shows as not applicable, and no narrative finding is shown
