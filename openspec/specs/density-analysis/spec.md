# density-analysis Specification

## Purpose

Measures how a page of agent context spends its cells, and tells the author, in
plain language, whether the representation is efficient or too busy and what to
change.

## Requirements

### Requirement: Live analysis on device
The system SHALL recompute every metric within one second after the page text
changes, without an explicit action, and SHALL compute all metrics on the
device, in the browser or in the local `a4` command line, without sending page
text over the network.

#### Scenario: Metrics follow typing
- **WHEN** the user types a sentence on an empty page
- **THEN** within one second the fill, ink, and token metrics are greater than zero

#### Scenario: No text leaves the device
- **WHEN** the user edits the page
- **THEN** no network request contains any part of the page text

#### Scenario: The command line computes locally
- **WHEN** the user runs `a4 lint` on a folder of context files
- **THEN** every metric is computed on the device and no network request is made

### Requirement: Fill and overflow
Rows used SHALL count wrapped rows through the last row that contains a
non-whitespace character. Fill SHALL be rows used divided by page rows, and
overflow SHALL be rows used minus page rows when positive, otherwise zero.

#### Scenario: Half a page
- **GIVEN** the Terminal preset
- **WHEN** the text has 30 non-blank lines of 40 characters
- **THEN** fill reads 50% and overflow reads 0

### Requirement: Ink coverage and crowding
Ink SHALL be the count of non-whitespace characters. Coverage SHALL be ink
divided by page capacity. Crowding SHALL be ink divided by the cells in used
rows (rows used times columns).

#### Scenario: Crowded rows
- **GIVEN** the Terminal preset
- **WHEN** the text is 10 lines of 80 non-whitespace characters
- **THEN** coverage reads about 17% and crowding reads 100%

### Requirement: Syntax overhead
Syntax overhead SHALL be the share of ink that is syntax characters: any
character that is not a letter, digit, or whitespace, except the sentence
punctuation . , ? ! ' ( ), their typographic forms (curly quotes, dashes,
ellipsis), and a hyphen between two letters or digits.

#### Scenario: JSON is syntax-heavy
- **WHEN** the page contains `{"id": "a1", "ok": true}`
- **THEN** syntax overhead is above 30%

#### Scenario: Prose is not
- **WHEN** the page contains only ordinary English sentences
- **THEN** syntax overhead is below 5%

### Requirement: Repetition
Terms SHALL be case-insensitive words of three or more characters, excluding
common English stopwords. Repetition SHALL be the share of term characters
spent on second and later occurrences. The system SHALL list the most repeated
terms with their counts, and count duplicated lines that contain a letter or
digit.

#### Scenario: Repeated keys
- **WHEN** a page lists 10 records that each contain the key "status"
- **THEN** "status" appears in the repeated-terms list with a count of 10

#### Scenario: Duplicate lines
- **WHEN** the same non-blank line appears 4 times
- **THEN** duplicate lines reads 3

### Requirement: Indentation waste
Indentation SHALL be leading whitespace characters divided by the cells in used
rows, and the system SHALL report the deepest indentation in columns.

#### Scenario: Nested structure
- **WHEN** lines are indented 2, 4, 6, and 8 spaces
- **THEN** the deepest indentation reads 8 columns and indentation is above 0%

### Requirement: Narrative share
The system SHALL classify each non-blank line as prose, structured, or heading,
and report narrative share as prose lines divided by prose plus structured
lines. A prose line SHALL have at least 6 words, at most 10% syntax characters,
and not start with { [ < or |.

#### Scenario: Sentences versus fields
- **WHEN** the page has 3 full sentences on separate lines and 3 lines of the form `key: value`
- **THEN** narrative share reads 50%

### Requirement: Estimated tokens
The system SHALL estimate the page's token count with an on-device heuristic,
label it as an estimate, and report characters per token. For plain English
prose the estimate SHALL fall between 0.18 and 0.32 tokens per character.

#### Scenario: Prose estimate is plausible
- **WHEN** the page holds 1,000 characters of English prose
- **THEN** the estimated token count is between 180 and 320

### Requirement: Compressibility
The system SHALL report compressibility as the deflate-compressed size divided
by the UTF-8 size of the page text, once the text has at least 200 characters.

#### Scenario: Repetitive text compresses well
- **WHEN** the page holds the same 40-character line 50 times
- **THEN** compressibility is below 10%

### Requirement: Verdict
The system SHALL assign one verdict, checking in order: Empty (no ink),
Overflowing (overflow above 0), Noisy (syntax at least 20%, repetition at least
40%, or at least 3 duplicate lines), Light (fill below 25%), Busy (crowding at
least 65% or indentation at least 12%), otherwise Balanced.

#### Scenario: Overflow wins over noise
- **WHEN** a page is both syntax-heavy and longer than the page
- **THEN** the verdict is Overflowing

#### Scenario: A short clean note
- **WHEN** the page holds 5 lines of plain prose
- **THEN** the verdict is Light

#### Scenario: A wall of text
- **WHEN** the page holds 40 consecutive rows of text with no blank lines and crowding of at least 65%
- **THEN** the verdict is Busy

### Requirement: Actionable findings
Each threshold crossed SHALL produce a finding with a severity (critical,
warning, or info) and a concrete suggestion. A repetition finding SHALL name
the most repeated term and its count.

#### Scenario: Overflow finding
- **WHEN** the text overflows the page by 7 rows
- **THEN** a critical finding says the page is 7 rows over and suggests cutting or splitting by purpose

#### Scenario: Repeated term finding
- **WHEN** the page holds 14 rows that each read "status status r<n>", so "status" is the most repeated term with 28 occurrences, and repetition is at least 40%
- **THEN** a warning finding names "status" and 28 and suggests stating shared values once

### Requirement: One set of signals
The verdict, the findings, and the state of each metric bar (ok, warn, or
bad) SHALL all come from one set of signals computed once per analysis. A bar
SHALL show warn or bad only when a finding about that metric is shown, and a
metric with no value (such as narrative share on a page too short to judge)
SHALL show as not applicable rather than 0.

#### Scenario: A short key-value page
- **GIVEN** a 3-line page of `key: value` lines
- **WHEN** it is analyzed
- **THEN** the Narrative bar shows as not applicable, and no narrative finding is shown
