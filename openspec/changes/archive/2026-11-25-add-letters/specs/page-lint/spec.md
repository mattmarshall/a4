# Spec Delta

## MODIFIED Requirements

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
