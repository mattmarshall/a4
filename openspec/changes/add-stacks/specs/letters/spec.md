# Spec Delta

## MODIFIED Requirements

### Requirement: The Letters group
When the open folder has letters, the folder section SHALL list them in a
**Letters** group above Context files, newest first. Each SHALL show its file
name, its state, its size, and its rows used on its size's Terminal grid,
marked when over that size's rows (60 for A4, 42 for A5, 29 for A6). The search
box SHALL filter letters by path.

#### Scenario: A sealed and a draft letter
- **GIVEN** an accepted letter and a newer draft
- **WHEN** the folder is listed
- **THEN** the Letters group shows the draft first, marked Draft, and then the letter marked Accepted

#### Scenario: An A5 card
- **GIVEN** the letter `2026-11-25-0930-auth.a5.md` uses 30 rows
- **WHEN** the folder is listed
- **THEN** the Letters group shows it as an A5 letter using 30 of 42 rows

### Requirement: Sealing a letter
On a draft letter, A4 SHALL offer **Seal…**, which saves pending edits and then
asks the person to **Accept** the letter or **Return** it. Return SHALL require
a reason. Accept SHALL be unavailable while the letter uses more rows than its
size holds. Canceling SHALL write nothing.

#### Scenario: Returning a letter
- **WHEN** the person chooses Return with the reason "Missing the rollback plan"
- **THEN** the postmark says returned with that reason, and the letter is not delivered

#### Scenario: A letter over the page
- **GIVEN** a draft letter that uses 63 rows
- **WHEN** the person opens Seal…
- **THEN** Accept is unavailable and the dialog says the letter is 3 rows over

#### Scenario: An A6 postcard over its page
- **GIVEN** a draft letter named `…-deploy.a6.md` that uses 31 rows
- **WHEN** the person opens Seal…
- **THEN** Accept is unavailable and the dialog says the letter is 2 rows over
