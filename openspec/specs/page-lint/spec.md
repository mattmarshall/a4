# page-lint Specification

## Purpose

Checks a repository's agent context files against the A4 page from the command
line, so a file that no longer fits on one page is caught in review or CI
instead of growing unseen.

## Requirements

### Requirement: Which files are checked
Given a folder (the current directory by default), `a4 lint` SHALL check the
context files and the letters the folder view lists, at any depth, and SHALL
skip the same folders the folder view skips. Given file paths, it SHALL check
exactly those files, whatever their names. A folder with no context files or
letters SHALL pass.

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

### Requirement: Measured as the sheet shows it
Each file SHALL be judged on the 80 × 60 Terminal page as the folder view shows
it: tabs as two spaces and carriage-return line endings as plain newlines. Its
rows used, verdict, and findings SHALL equal what the app shows for the same
file.

#### Scenario: A file over one page
- **GIVEN** a root `AGENTS.md` that lays out to 74 rows on the Terminal grid
- **WHEN** the user runs `a4 lint`
- **THEN** it reports "AGENTS.md" as 74 of 60 rows, 14 over, with the verdict Overflowing

#### Scenario: Tabs and CRLF
- **GIVEN** a file with CRLF line endings whose lines start with one tab
- **WHEN** it is checked
- **THEN** each tab counts as 2 cells and each line ending as one newline, as on the sheet

### Requirement: Pass and fail
A file SHALL fail when its rows used exceed 60. The command SHALL exit with
status 1 when any checked file fails, and with status 0 otherwise.

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

### Requirement: Strict mode
With `--strict`, a file whose verdict is Noisy or Busy SHALL also fail. Without
it, those files SHALL be reported as warnings and SHALL NOT fail. Empty, Light,
and Balanced files SHALL never fail.

#### Scenario: A noisy file
- **GIVEN** a context file that fits but has 24% syntax overhead, so its verdict is Noisy
- **WHEN** the user runs `a4 lint`
- **THEN** it is reported as a warning and the command exits with status 0

#### Scenario: A noisy file in strict mode
- **GIVEN** the same file
- **WHEN** the user runs `a4 lint --strict`
- **THEN** it fails and the command exits with status 1

### Requirement: Exclusions
Each `--exclude <glob>` SHALL remove the files whose path, relative to the
folder and written with `/`, matches the glob. The option SHALL be repeatable.

#### Scenario: Excluding generated skills
- **GIVEN** a folder holding `AGENTS.md` and `.claude/skills/review/SKILL.md`
- **WHEN** the user runs `a4 lint --exclude '.claude/skills/**'`
- **THEN** it checks "AGENTS.md" only

### Requirement: Files that can't be read
A file larger than 1 MiB (1,048,576 bytes), or one that isn't valid UTF-8, SHALL
be reported with its reason and SHALL fail. A path given on the command line
that doesn't exist SHALL be a usage error.

#### Scenario: A file that isn't UTF-8
- **GIVEN** a `CLAUDE.md` holding invalid UTF-8 bytes
- **WHEN** the user runs `a4 lint`
- **THEN** it reports "CLAUDE.md" as not UTF-8 text and exits with status 1

#### Scenario: A missing path
- **WHEN** the user runs `a4 lint missing.md` and that file doesn't exist
- **THEN** it says the path doesn't exist and exits with status 2

### Requirement: Partial scans
A folder scan SHALL stop after visiting 20,000 entries and SHALL say that the
list is partial. A partial scan alone SHALL NOT make the command fail.

#### Scenario: A very large folder
- **GIVEN** a folder with more than 20,000 entries and no failing context files among those visited
- **WHEN** the user runs `a4 lint`
- **THEN** it says the scan stopped at 20,000 entries and exits with status 0

### Requirement: The report
Without `--json`, the command SHALL print one line per file with its path, rows
used out of 60, its outcome, its verdict, and its most severe finding, then a
summary line. With `--json`, it SHALL print one `a4.v1.LintReport` as protobuf
JSON and nothing else on standard output.

#### Scenario: Text report
- **GIVEN** a root `AGENTS.md` that uses 74 rows
- **WHEN** the user runs `a4 lint`
- **THEN** its line names "AGENTS.md", shows 74/60, says it fails as Overflowing, and gives the finding that it is 14 rows over

#### Scenario: JSON report
- **WHEN** the user runs `a4 lint --json`
- **THEN** standard output parses as an `a4.v1.LintReport` listing each file's path, outcome, and analysis report

### Requirement: No text in the report
The JSON report SHALL NOT contain any file's text. It SHALL carry only paths,
outcomes, reasons, and each file's analysis report, which holds metrics,
signals, the verdict, findings, and the most repeated terms.

#### Scenario: A secret in a context file
- **GIVEN** a `CLAUDE.md` containing the line "token: sk-test-123"
- **WHEN** the user runs `a4 lint --json`
- **THEN** the output does not contain "sk-test-123"

### Requirement: Read-only and on device
The command SHALL NOT create, change, or delete any file, and SHALL NOT make any
network request.

#### Scenario: Linting leaves the folder unchanged
- **GIVEN** a folder of context files
- **WHEN** the user runs `a4 lint` in it
- **THEN** every file's bytes and modification time are unchanged afterward

### Requirement: Usage errors
An unknown command or option, or a missing value for an option that needs one,
SHALL print the usage and exit with status 2. `a4 --help` and `a4 lint --help`
SHALL print the usage and exit with status 0.

#### Scenario: An unknown option
- **WHEN** the user runs `a4 lint --fast`
- **THEN** it prints the usage and exits with status 2
