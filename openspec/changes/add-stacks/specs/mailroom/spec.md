# Spec Delta

## MODIFIED Requirements

### Requirement: Checking a page
`lint_page` SHALL judge `text` as the folder view shows it on the Terminal page
of the optional `size` (a4, a5, or a6; a4 by default). It SHALL return the rows
used out of that size's rows, the rows over, the outcome, the verdict, and the
findings, equal to what `a4 lint` reports for a file of that size holding that
text. It SHALL write nothing.

#### Scenario: A page over
- **WHEN** a client checks text that lays out to 74 rows
- **THEN** the result says 74 of 60 rows, 14 over, the outcome fail, and the verdict Overflowing

#### Scenario: A noisy page
- **WHEN** a client checks text that fits but has 24% syntax overhead
- **THEN** the result's outcome is warn and its verdict is Noisy

#### Scenario: Checking a card
- **WHEN** a client checks text that lays out to 45 rows on A5 with `size` "a5"
- **THEN** the result says 45 of 42 rows, 3 over

### Requirement: Filing a letter
`write_letter` SHALL create a new draft letter holding the exact UTF-8 bytes of
`text` at `.agents/letters/<UTC YYYY-MM-DD-HHMM>-<topic>.md`, where the topic
defaults to "letter", and SHALL create `.agents/letters/` when it is missing.
With `size` "a5" or "a6", the name SHALL end in `.a5.md` or `.a6.md`. It SHALL
return the letter's path, its digest, and its check, and SHALL say that the
letter is a draft a person must seal before it is delivered.

#### Scenario: Filing a letter with a topic
- **WHEN** a client files 40 rows of text with the topic "auth-migration" at 09:30 UTC on November 25, 2026
- **THEN** `.agents/letters/2026-11-25-0930-auth-migration.md` holds exactly that text, and the result gives its digest and says it is a draft until a person seals it

#### Scenario: Filing a letter without a topic
- **WHEN** a client files a letter at 09:30 UTC on November 25, 2026 without a topic
- **THEN** it is filed as `.agents/letters/2026-11-25-0930-letter.md`

#### Scenario: Filing a card
- **WHEN** a client files 30 rows of A5 text with the topic "auth" and `size` "a5" at 09:30 UTC on November 25, 2026
- **THEN** it is filed as `.agents/letters/2026-11-25-0930-auth.a5.md`

### Requirement: Only letters that fit are filed
When `text` uses more rows than its size holds (60 for A4, 42 for A5, 29 for
A6), `write_letter` SHALL write nothing and SHALL return an error result with
the rows over, the verdict, and the findings, so the agent can rewrite it. A
letter that fits but is Noisy or Busy SHALL be filed, and the result SHALL give
its verdict.

#### Scenario: A letter over the page
- **WHEN** a client files text that uses 63 rows
- **THEN** no file is written, and the error result says the letter is 3 rows over

#### Scenario: Exactly one page
- **WHEN** a client files text whose rows used is exactly 60
- **THEN** the letter is filed

#### Scenario: A noisy letter
- **WHEN** a client files text that fits but whose verdict is Noisy
- **THEN** the letter is filed, and the result gives the verdict Noisy

#### Scenario: A postcard over its page
- **WHEN** a client files text that uses 31 rows on A6 with `size` "a6"
- **THEN** no file is written, and the error result says the letter is 2 rows over

## ADDED Requirements

### Requirement: Sizes the mailroom accepts
`lint_page` and `write_letter` SHALL accept an optional `size` of "a4", "a5", or
"a6", declared in their input schemas. Any other value SHALL be an error result,
and `write_letter` SHALL write nothing.

#### Scenario: An unknown size
- **WHEN** a client files a letter with `size` "a3"
- **THEN** no file is written, and the result is an error
