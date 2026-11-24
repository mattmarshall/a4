# Spec Delta

## ADDED Requirements

### Requirement: Slots stay consistent
Opening pages into a slot SHALL happen one at a time per slot, so each slot
ends up showing the page from the last request, with exactly one open
session.

#### Scenario: Switching modes quickly
- **WHEN** the user switches Single → Compare → Single within 100 ms
- **THEN** only slot A is open, and slot B has no session left saving in the background

#### Scenario: Fit to page while Compare opens
- **WHEN** Fit to page finishes at the same moment Compare is opening a page in slot B
- **THEN** slot B shows the Fit to page result, and the other page was closed cleanly
