# page-export Specification

## Purpose

Gets a finished page out of A4 and into an agent's context, a repository, or
onto real paper, without altering the text.

## Requirements

### Requirement: Copy page text
The system SHALL copy the active page's text to the clipboard exactly as stored,
and confirm the copy to the user.

#### Scenario: Copying
- **WHEN** the user chooses Copy
- **THEN** the clipboard holds the page text byte for byte and a confirmation appears

### Requirement: Download page text
The system SHALL download the active page as a UTF-8 .md file holding exactly
the page text, named after the page (lowercase, hyphen-separated, at most 48
characters), or "a4-page.md" when no name can be derived.

#### Scenario: Named download
- **WHEN** the open page is named "INCIDENT INC-2291 · Checkout latency"
- **THEN** the downloaded file is named "incident-inc-2291-checkout-latency.md"

### Requirement: True-size print
Printing SHALL produce one A4 sheet at 1:1 scale with the preset's cell size and
margins, showing only the page text in black, without application chrome,
lenses, gauges, or overflow rows.

#### Scenario: Printing a page
- **WHEN** the user chooses Print and prints to A4 paper
- **THEN** the printout shows the page text on the grid at the preset's physical size with no toolbar or sidebar
