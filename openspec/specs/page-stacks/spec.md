# page-stacks Specification

## Purpose

Stacks: piles of pages with a page budget in a repository's `.agents/stacks/`,
so the context an agent is handed can be counted in pages, judged as a whole,
and delivered in one piece.

## Requirements

### Requirement: Where stacks live
A stack SHALL be a folder directly inside `.agents/stacks/`, named with 1 to 40
characters of lowercase letters a to z, digits, and single inner hyphens. Its
pages SHALL be the `.md` files directly inside that folder, ordered by file
name without the `.md` extension. Files in its subfolders SHALL NOT be pages,
and a folder with another name SHALL NOT be a stack.

#### Scenario: A stack of three pages
- **GIVEN** `.agents/stacks/auth/` holds `01-charter.md`, `02-service.a5.md`, `03-owners.a6.md`, and `old/draft.md`
- **WHEN** the folder is listed
- **THEN** the stack "auth" has the pages "01-charter.md", "02-service.a5.md", and "03-owners.a6.md", in that order

#### Scenario: Not a stack
- **GIVEN** `.agents/stacks/Auth Notes/01.md` exists
- **WHEN** the folder is listed
- **THEN** "Auth Notes" is not a stack

### Requirement: The label
A stack's `stack.json` SHALL be an `a4.v1.StackLabel` in proto3 JSON giving the
stack's purpose and its budget in whole pages, at least 1. A stack whose label
is missing, can't be read, or has no budget SHALL be listed with that reason
and SHALL have no budget.

#### Scenario: A labeled stack
- **GIVEN** `.agents/stacks/auth/stack.json` holds `{"purpose": "Start an agent on the auth service", "budgetPages": 3}`
- **WHEN** the stack is read
- **THEN** its purpose is "Start an agent on the auth service" and its budget is 3 pages

#### Scenario: No label
- **GIVEN** `.agents/stacks/auth/` has pages and no `stack.json`
- **WHEN** the stack is read
- **THEN** it is listed as having no label, and no budget

### Requirement: Counting pages
Each page SHALL count toward its stack by its paper, whatever its rows used: an
A4 page as 1 page, an A5 page as 0.5, and an A6 page as 0.25. A stack's pages
used SHALL be the sum over its pages.

#### Scenario: Mixed sizes
- **GIVEN** a stack of two A4 pages, one A5 page, and two A6 pages
- **WHEN** it is judged
- **THEN** it uses 3 pages

### Requirement: Judging a stack
A stack SHALL fail when its pages used exceed its budget, or when any of its
pages uses more rows than its size holds. It SHALL warn when it has no budget
or when lines repeat across its pages, and SHALL pass otherwise. Each page
SHALL be judged on its own size as the sheet shows it.

#### Scenario: Over budget
- **GIVEN** a stack with a budget of 2 pages that uses 2.5
- **WHEN** it is judged
- **THEN** it fails, 0.5 pages over its budget

#### Scenario: A page over its size
- **GIVEN** a stack within its budget whose A5 page uses 45 rows
- **WHEN** it is judged
- **THEN** it fails, naming that page as 3 rows over

### Requirement: Saying each thing once
A non-blank line of at least 20 characters, compared after trimming spaces at
both ends, that appears on two or more pages of a stack SHALL be reported as
repeated across pages, naming the pages it is on.

#### Scenario: A fact on two pages
- **GIVEN** the line "The auth service owns sessions and refresh tokens." appears on "01-charter.md" and "03-owners.a6.md"
- **WHEN** the stack is judged
- **THEN** it warns that the line repeats on "01-charter.md" and "03-owners.a6.md"

### Requirement: The Stacks group
When the open folder has stacks, the folder section SHALL list them in a
**Stacks** group after Letters and before Context files. Each stack SHALL show
its name, its pages used out of its budget, and its outcome, then its pages in
order, each with its size and its rows used out of its size's rows. The search
box SHALL filter stack pages by path.

#### Scenario: A stack in the folder view
- **GIVEN** the stack "auth" with a budget of 3, using 1.75 pages
- **WHEN** the folder is listed
- **THEN** the Stacks group shows "auth" with "1.75 of 3 pages", and its pages with their sizes

### Requirement: Listing stacks from the command line
`a4 stacks [folder]` (the current directory by default) SHALL print one line per
stack, in name order, with its outcome, pages used out of its budget, name, and
purpose, then a line for each problem found. It SHALL exit with status 0. With
`--json`, it SHALL print only an `a4.v1.StackList`, without any page's text.

#### Scenario: Listing a folder's stacks
- **GIVEN** the stacks "auth" (1.75 of 3 pages) and "billing" (2.5 of 2 pages)
- **WHEN** the user runs `a4 stacks`
- **THEN** "auth" is listed as passing, and "billing" as failing 0.5 pages over its budget

### Requirement: Delivering a stack
`a4 stack <name> [folder]` SHALL print the exact text of the stack's pages in
order, each after a line `--- <file name> ---`. With `--letter`, it SHALL first
print what `a4 letters --latest` prints. A stack that fails SHALL still be
printed, with its problems on standard error, and the command SHALL exit with
status 0. A stack that doesn't exist SHALL be a usage error with exit status 2.

#### Scenario: A stack with the latest letter on top
- **GIVEN** the stack "auth" with pages "01-charter.md" and "02-service.a5.md", and an accepted letter
- **WHEN** the user runs `a4 stack auth --letter`
- **THEN** it prints the letter's text, then "--- 01-charter.md ---" and that page's text, then "--- 02-service.a5.md ---" and that page's text

#### Scenario: No such stack
- **WHEN** the user runs `a4 stack missing`
- **THEN** it says the stack doesn't exist and exits with status 2

### Requirement: The stack commands only read
`a4 stacks` and `a4 stack` SHALL NOT create, change, or delete any file, and
SHALL NOT make any network request.

#### Scenario: Delivering leaves the folder unchanged
- **WHEN** the user runs `a4 stack auth --letter`
- **THEN** every file's bytes and modification time are unchanged afterward
