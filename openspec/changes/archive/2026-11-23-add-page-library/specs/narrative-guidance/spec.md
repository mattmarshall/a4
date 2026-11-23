# Spec Delta

## MODIFIED Requirements

### Requirement: Worked incident sample
The system SHALL include an incident described twice with the same facts: once
as JSON and once as a narrative page. On the Terminal preset the JSON version
SHALL be Noisy or Overflowing and the narrative version SHALL be neither.

#### Scenario: Loading the comparison demo
- **WHEN** the user loads the JSON-versus-narrative demo
- **THEN** two new pages holding the JSON and narrative samples are created and compare mode opens with the JSON page in slot A and the narrative page in slot B

### Requirement: Safe loading
Loading a template or sample SHALL create new pages and SHALL NOT change the
text of any existing page.

#### Scenario: Declining a template
- **GIVEN** page "Brief" is open with text
- **WHEN** the user opens the templates menu and dismisses it without choosing
- **THEN** no page is created and "Brief" is unchanged

#### Scenario: Template creates a page
- **GIVEN** page "Brief" is open with text
- **WHEN** the user picks a template
- **THEN** a new page holding the template is created and opened, and "Brief" is unchanged

### Requirement: Welcome page
On a first visit with an empty library and nothing to migrate, the system SHALL
create a page named "Welcome" containing a welcome text that explains A4,
written as a one-page narrative that fits the Terminal page, and open it.

#### Scenario: First visit
- **GIVEN** a browser with no saved A4 pages
- **WHEN** the user opens the workbench
- **THEN** the "Welcome" page is open and its verdict is not Overflowing
