# page-comparison Specification

## Purpose

Puts two representations of the same context side by side so the author can
keep the one that carries more meaning per cell.

## Requirements

### Requirement: Two-page compare mode
The system SHALL offer a compare mode that shows two pages, A and B, as two
sheets side by side in the current rendering (3D or Flat), on the same preset
and lens. Each sheet SHALL be independently editable and autosaved. The user
SHALL choose which page is shown in each slot from the library or, when a
folder is open, from the folder's files.

#### Scenario: Entering compare mode
- **WHEN** the user switches to compare mode
- **THEN** two sheets labeled A and B are shown, and typing in one does not change the other

#### Scenario: Choosing page B
- **WHEN** the user picks page "Narrative" for slot B
- **THEN** sheet B shows "Narrative" and edits to it are saved to that page

#### Scenario: Comparing in 3D
- **GIVEN** the 3D rendering
- **WHEN** the user switches to compare mode
- **THEN** both pages render as 3D sheets that share the camera and light, and each keeps its own fold and curl

#### Scenario: A file beside a library page
- **GIVEN** the folder "a4" is open
- **WHEN** the user picks "AGENTS.md" for slot A and the library page "Charter" for slot B
- **THEN** sheet A shows the file, sheet B shows "Charter", and edits to A are saved to the file

### Requirement: Metric deltas
In compare mode the system SHALL show each metric for A and B with the
difference, and SHALL mark the better value using each metric's direction
(lower is better for overflow, syntax, repetition, indentation, and tokens;
higher is better for narrative share).

#### Scenario: Narrative page wins on syntax
- **GIVEN** page A is the JSON incident sample and page B is the narrative incident sample
- **WHEN** compare mode is active
- **THEN** B's syntax overhead is marked better and the delta shows how many points lower it is

### Requirement: Page operations
The system SHALL let the user swap the pages in slots A and B, and duplicate
page A into a new page shown in slot B.

#### Scenario: Swap pages
- **WHEN** the user swaps pages
- **THEN** slot A shows the page that was in B and slot B shows the page that was in A

#### Scenario: Duplicate A into B
- **WHEN** the user duplicates A into B
- **THEN** a new page holding A's text is created and shown in slot B, and the page previously in B is unchanged

### Requirement: Leaving compare mode
Leaving compare mode SHALL return to the page in slot A, and SHALL remember the
page in slot B for the next time compare mode is opened.

#### Scenario: B survives
- **GIVEN** slot B shows page "Narrative"
- **WHEN** the user leaves and re-enters compare mode
- **THEN** slot B still shows "Narrative" with the same text

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
