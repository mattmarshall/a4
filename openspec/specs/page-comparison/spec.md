# page-comparison Specification

## Purpose

Puts two representations of the same context side by side so the author can
keep the one that carries more meaning per cell.

## Requirements

### Requirement: Two-page compare mode
The system SHALL offer a compare mode that shows page A and page B side by side
on the same preset and lens, each independently editable.

#### Scenario: Entering compare mode
- **WHEN** the user switches to compare mode
- **THEN** two sheets labeled A and B are shown, and typing in one does not change the other

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
The system SHALL let the user swap A and B and copy A into B.

#### Scenario: Swap pages
- **WHEN** the user swaps pages
- **THEN** A holds B's former text and B holds A's former text

### Requirement: Leaving compare mode
Leaving compare mode SHALL return to page A and SHALL keep page B's text for the
next time compare mode is opened.

#### Scenario: B survives
- **GIVEN** page B has text
- **WHEN** the user leaves and re-enters compare mode
- **THEN** page B still has the same text
