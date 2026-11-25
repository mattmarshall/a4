# context-xray Specification

## Purpose

The context X-ray: a picture, in pages, of what a coding agent loads from files
before its first turn, so the standing context an agent carries can be counted,
judged, and budgeted like any other stack of paper.

## Requirements

### Requirement: Memory files the X-ray reads
`a4 xray [folder]` (the current directory by default) SHALL list, in load
order, the memory files Claude Code loads at session start there: the managed
policy `CLAUDE.md` for the operating system, `~/.claude/CLAUDE.md`, and
`CLAUDE.md`, `.claude/CLAUDE.md`, and `CLAUDE.local.md` in each folder from the
filesystem root down to the folder. When none of those three exists on that
walk, `AGENTS.md` and `.claude/AGENTS.md` on it SHALL be listed instead.

#### Scenario: A repository with a project file and a user file
- **GIVEN** `~/.claude/CLAUDE.md`, and a repository whose root holds `CLAUDE.md` and `src/CLAUDE.md`
- **WHEN** the user runs `a4 xray` at the repository root
- **THEN** it lists `~/.claude/CLAUDE.md` then the root `CLAUDE.md`, and not `src/CLAUDE.md`, which loads only on demand

#### Scenario: AGENTS.md without CLAUDE files
- **GIVEN** a repository whose root holds `AGENTS.md` and no `CLAUDE` files on the walk
- **WHEN** the user runs `a4 xray` there
- **THEN** it lists `AGENTS.md`

### Requirement: Rules the X-ray reads
The X-ray SHALL list the `.md` files at any depth in `~/.claude/rules/` and then
in the folder's `.claude/rules/` whose front matter has no `paths`, since those
load at start. A rule with `paths` loads only when a matching file is touched
and SHALL NOT be listed.

#### Scenario: A conditional rule
- **GIVEN** `.claude/rules/api.md` with `paths: ["src/api/**"]` and `.claude/rules/style.md` without `paths`
- **WHEN** the user runs `a4 xray`
- **THEN** it lists `style.md` and not `api.md`

### Requirement: Imports
The X-ray SHALL follow `@path` imports in the files it lists, resolving a
relative path against the importing file and `~` against the home folder, up to
four hops. It SHALL ignore `@` text inside code spans and fenced code blocks,
list each imported file once after the file that first imports it, and say
which file imported it.

#### Scenario: An imported file
- **GIVEN** a root `CLAUDE.md` containing the line "See @docs/agents.md for conventions."
- **WHEN** the user runs `a4 xray`
- **THEN** `docs/agents.md` is listed after `CLAUDE.md`, imported by it

#### Scenario: An import in a code span
- **GIVEN** a root `CLAUDE.md` containing "`@docs/example.md`" inside backticks
- **WHEN** the user runs `a4 xray`
- **THEN** `docs/example.md` is not listed

### Requirement: Memory and descriptions
The X-ray SHALL count the first 200 lines, at most 25 KB, of auto memory's
`MEMORY.md` for the folder's project. It SHALL count each skill's name and
description, and each subagent's name and description, as one index source
each: skills from `~/.claude/skills/` and the `.claude/skills/` folders from
the folder up to its repository root, and subagents from the matching `agents`
folders. A skill with `disable-model-invocation: true` SHALL NOT be counted.

#### Scenario: A long MEMORY.md
- **GIVEN** a `MEMORY.md` of 260 short lines for the project
- **WHEN** the user runs `a4 xray`
- **THEN** it counts the first 200 lines

#### Scenario: Skills as one index
- **GIVEN** three project skills and two personal skills, one of them with `disable-model-invocation: true`
- **WHEN** the user runs `a4 xray`
- **THEN** it lists one skill index source counting four skills' names and descriptions

### Requirement: The window in pages
Each source SHALL be judged on the A4 Terminal page as the folder view shows
it, and its pages SHALL be its rows used divided by 60. The X-ray SHALL report,
for each source, its kind, its path, its rows, its pages, its estimated tokens,
and its verdict, and in total, the pages and estimated tokens before the first
turn.

#### Scenario: Two sources
- **GIVEN** a user `CLAUDE.md` that uses 30 rows and a project `CLAUDE.md` that uses 90
- **WHEN** the user runs `a4 xray`
- **THEN** they count 0.5 and 1.5 pages, and the total is 2 pages

### Requirement: What isn't counted
The X-ray SHALL say that it doesn't count what isn't a file it can read: the
agent's system prompt, tool and MCP definitions, plugin skills and subagents,
output styles, and the output of session-start hooks.

#### Scenario: The report's footnote
- **WHEN** the user runs `a4 xray`
- **THEN** the report ends with a line saying the system prompt, tool and MCP definitions, plugins, output styles, and hook output aren't counted

### Requirement: A start-up budget
With `--budget <pages>`, the X-ray SHALL exit with status 1 when the total
pages exceed the budget, and with status 0 otherwise. Without it, the X-ray
SHALL exit with status 0. A folder that doesn't exist, or a budget that isn't a
positive number, SHALL be a usage error with exit status 2.

#### Scenario: Over a budget
- **GIVEN** start-up context that totals 6.25 pages
- **WHEN** the user runs `a4 xray --budget 5`
- **THEN** it says the context is 1.25 pages over 5 and exits with status 1

### Requirement: The X-ray record
With `--json`, the X-ray SHALL print only an `a4.v1.ContextXray` in proto3 JSON:
each source's kind, path, the file that imported it, rows, pages, tokens, and
analysis report, plus the totals, the budget, and what isn't counted.

#### Scenario: JSON output
- **WHEN** the user runs `a4 xray --json`
- **THEN** standard output parses as an `a4.v1.ContextXray` listing each source

### Requirement: Paths and numbers only
The X-ray SHALL NOT print any file's text, in text or JSON, beyond what an
analysis report already carries. It SHALL write paths under the home folder as
`~/…`. It SHALL NOT create, change, or delete any file, and SHALL NOT make any
network request.

#### Scenario: A secret in CLAUDE.md
- **GIVEN** a `CLAUDE.md` containing the line "token: sk-test-123"
- **WHEN** the user runs `a4 xray --json`
- **THEN** the output does not contain "sk-test-123", and no file has changed

### Requirement: Files the X-ray can't read
A listed file larger than 1 MiB, or one that isn't UTF-8 text, SHALL be reported
with its reason and SHALL count no pages. A missing file SHALL NOT be listed. An
import that can't be found SHALL be reported as missing, naming the file that
imports it.

#### Scenario: A missing import
- **GIVEN** a `CLAUDE.md` that imports `@docs/gone.md`, which doesn't exist
- **WHEN** the user runs `a4 xray`
- **THEN** the report says `docs/gone.md`, imported by `CLAUDE.md`, is missing
