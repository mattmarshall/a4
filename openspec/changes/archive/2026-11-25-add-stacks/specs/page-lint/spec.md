# Spec Delta

## MODIFIED Requirements

### Requirement: Which files are checked
Given a folder (the current directory by default), `a4 lint` SHALL check the
context files, the letters, and the stack pages the folder view lists, at any
depth, and SHALL skip the same folders the folder view skips. Given file paths,
it SHALL check exactly those files, whatever their names. A folder with none of
these SHALL pass.

#### Scenario: A folder with a context file and other Markdown
- **GIVEN** a folder holding `AGENTS.md`, `.claude/skills/review/SKILL.md`, and `README.md`
- **WHEN** the user runs `a4 lint` in it
- **THEN** it checks "AGENTS.md" and ".claude/skills/review/SKILL.md" and not "README.md"

#### Scenario: A file named on the command line
- **WHEN** the user runs `a4 lint README.md`
- **THEN** it checks "README.md"

#### Scenario: Skipped folders
- **GIVEN** a folder holding `node_modules/pkg/AGENTS.md`
- **WHEN** the user runs `a4 lint` in it
- **THEN** that file is not checked

#### Scenario: Nothing to check
- **GIVEN** a folder with no context files
- **WHEN** the user runs `a4 lint` in it
- **THEN** it says no context files were found and exits with status 0

#### Scenario: A letter over the page
- **GIVEN** a folder holding `.agents/letters/2026-11-25-0930-auth.md`, which uses 63 rows
- **WHEN** the user runs `a4 lint` in it
- **THEN** it checks that letter, reports it 3 rows over, and exits with status 1

#### Scenario: A stack page
- **GIVEN** a folder holding `.agents/stacks/auth/01-charter.md`
- **WHEN** the user runs `a4 lint` in it
- **THEN** it checks "01-charter.md" as a page of the stack "auth"

### Requirement: Measured as the sheet shows it
Each file SHALL be judged on its own size's Terminal page (80 × 60 for A4,
56 × 42 for A5, 40 × 29 for A6) as the folder view shows it: tabs as two spaces
and carriage-return line endings as plain newlines. Its rows used, verdict, and
findings SHALL equal what the app shows for the same file.

#### Scenario: A file over one page
- **GIVEN** a root `AGENTS.md` that lays out to 74 rows on the Terminal grid
- **WHEN** the user runs `a4 lint`
- **THEN** it reports "AGENTS.md" as 74 of 60 rows, 14 over, with the verdict Overflowing

#### Scenario: Tabs and CRLF
- **GIVEN** a file with CRLF line endings whose lines start with one tab
- **WHEN** it is checked
- **THEN** each tab counts as 2 cells and each line ending as one newline, as on the sheet

#### Scenario: An A5 card
- **GIVEN** `docs/auth-card.a5.md` with lines of 70 characters
- **WHEN** the user runs `a4 lint docs/auth-card.a5.md`
- **THEN** each of those lines wraps to 2 rows on the 56-column grid, and the file is measured out of 42 rows

### Requirement: Pass and fail
A file SHALL fail when its rows used exceed its size's rows: 60 for A4, 42 for
A5, and 29 for A6. The command SHALL exit with status 1 when any checked file
or stack fails, and with status 0 otherwise.

#### Scenario: One file over
- **GIVEN** two context files, one using 74 rows and one using 20
- **WHEN** the user runs `a4 lint`
- **THEN** the 74-row file fails, the 20-row file passes, and the command exits with status 1

#### Scenario: Exactly one page
- **GIVEN** a context file whose rows used is exactly 60
- **WHEN** it is checked
- **THEN** it passes

#### Scenario: Trailing blank lines
- **GIVEN** a file with 58 rows of text followed by 5 blank lines
- **WHEN** it is checked
- **THEN** its rows used is 58 and it passes

#### Scenario: An A6 postcard over its page
- **GIVEN** a file `note.a6.md` that uses 31 rows
- **WHEN** it is checked
- **THEN** it fails, 2 rows over

## ADDED Requirements

### Requirement: Stack budgets
When `a4 lint` scans a folder, it SHALL also judge each stack in it as a stack
is judged: a stack over its budget, or with a page over its size, SHALL fail,
and a stack with no budget or with lines repeated across pages SHALL warn. The
report SHALL give one line per stack, and `--json` SHALL list each stack's
`a4.v1.StackReport` in the `a4.v1.LintReport`.

#### Scenario: A stack over its budget
- **GIVEN** the stack "billing" with a budget of 2 pages that uses 2.5
- **WHEN** the user runs `a4 lint`
- **THEN** it reports "billing" failing 0.5 pages over its budget and exits with status 1
