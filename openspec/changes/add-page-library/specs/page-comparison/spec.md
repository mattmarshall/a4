# Spec Delta

## MODIFIED Requirements

### Requirement: Two-page compare mode
The system SHALL offer a compare mode that shows two library pages, A and B,
side by side on the same preset and lens, each independently editable and
autosaved. The user SHALL choose which page is shown in each slot from the
library.

#### Scenario: Entering compare mode
- **WHEN** the user switches to compare mode
- **THEN** two sheets labeled A and B are shown, and typing in one does not change the other

#### Scenario: Choosing page B
- **WHEN** the user picks page "Narrative" for slot B
- **THEN** sheet B shows "Narrative" and edits to it are saved to that page

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
