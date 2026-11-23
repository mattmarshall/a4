# narrative-guidance Specification

## Purpose

Teaches the practice of writing narrative agent context: one-page templates to
start from, a worked before-and-after sample, and an explainer of why the page
constraint matters.

## Requirements

### Requirement: Template catalog
The system SHALL offer the templates Situation Brief, Entity Card, Handoff,
Decision Record, and Agent Charter. Each template SHALL state the page's purpose
on its first lines and SHALL fit on the Terminal page with no overflow.

#### Scenario: Templates fit
- **WHEN** any template is loaded on the Terminal preset
- **THEN** overflow reads 0

### Requirement: Worked incident sample
The system SHALL include an incident described twice with the same facts: once
as JSON and once as a narrative page. On the Terminal preset the JSON version
SHALL be Noisy or Overflowing and the narrative version SHALL be neither.

#### Scenario: Loading the comparison demo
- **WHEN** the user loads the JSON-versus-narrative demo
- **THEN** compare mode opens with the JSON sample on page A and the narrative sample on page B

### Requirement: Safe loading
Loading a template or sample into a page that has text SHALL ask for
confirmation first, and SHALL not change the page if the user declines.

#### Scenario: Declining a template
- **GIVEN** page A has text
- **WHEN** the user picks a template and declines the confirmation
- **THEN** page A's text is unchanged

### Requirement: Welcome page
On a first visit with no saved text, page A SHALL contain a welcome page that
explains A4, written as a one-page narrative that fits the Terminal page.

#### Scenario: First visit
- **GIVEN** a browser with no saved A4 text
- **WHEN** the user opens the workbench
- **THEN** page A shows the welcome page and its verdict is not Overflowing

### Requirement: Why A4 explainer
The system SHALL serve an explainer at /why that defines the problem A4
addresses, how the page constraint and lenses address it, and practices for
writing narrative context for agents, linked from the workbench.

#### Scenario: Reading the explainer
- **WHEN** the user follows the Why A4 link from the workbench
- **THEN** the /why page loads with sections on the problem, the approach, and narrative practice
