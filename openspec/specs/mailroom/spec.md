# mailroom Specification

## Purpose

A local MCP server, the mailroom, through which coding agents and outside
systems file one-page letters after the desk's fit check and read only the
letters a person has sealed and accepted.

## Requirements

### Requirement: Starting the mailroom
`a4 mailroom [folder]` SHALL serve the Model Context Protocol for one folder,
the current directory by default, over standard input and output, one
JSON-RPC 2.0 message per line. Standard output SHALL carry only protocol
messages. When standard input closes, the command SHALL exit with status 0. A
folder that doesn't exist SHALL be a usage error with exit status 2, before
anything is served.

#### Scenario: Initializing
- **WHEN** a client sends `initialize` with protocol version "2025-06-18"
- **THEN** the result names the server "a4-mailroom", offers tools and prompts, and gives protocol version "2025-06-18"

#### Scenario: The client goes away
- **GIVEN** a running mailroom
- **WHEN** its standard input closes
- **THEN** it exits with status 0

#### Scenario: A missing folder
- **WHEN** the user runs `a4 mailroom missing` and that folder doesn't exist
- **THEN** it says the folder doesn't exist and exits with status 2

### Requirement: Protocol versions
The mailroom SHALL support MCP protocol versions "2025-06-18" and
"2025-11-25". It SHALL answer `initialize` with the client's version when it
supports it, and with "2025-11-25" otherwise. It SHALL answer `ping` with an
empty result.

#### Scenario: An older client
- **WHEN** a client sends `initialize` with protocol version "2024-11-05"
- **THEN** the result gives protocol version "2025-11-25"

### Requirement: Three tools, annotated
`tools/list` SHALL list exactly `lint_page`, `write_letter`, and
`read_letter`, each with a title, a description, and an input schema that
allows no other arguments. `lint_page` and `read_letter` SHALL be annotated
`readOnlyHint: true`. `write_letter` SHALL be annotated `readOnlyHint: false`,
`destructiveHint: false`, and `idempotentHint: false`. Every tool SHALL be
annotated `openWorldHint: false`.

#### Scenario: Listing tools
- **WHEN** a client calls `tools/list`
- **THEN** it gets three tools, `lint_page` and `read_letter` with `readOnlyHint: true`, and `write_letter` with `readOnlyHint: false` and `destructiveHint: false`

### Requirement: No tool seals or changes a letter
The mailroom SHALL offer no tool that seals, edits, renames, or deletes a
letter, and SHALL NOT write a postmark. Agents write; people seal.

#### Scenario: A session of calls
- **GIVEN** a folder with an accepted letter and a draft letter
- **WHEN** a client calls `lint_page`, `write_letter`, and `read_letter`
- **THEN** no postmark file was created or changed, and both existing letters' bytes are unchanged

### Requirement: Checking a page
`lint_page` SHALL judge `text` as the folder view shows it on the 80 × 60
Terminal page. It SHALL return the rows used out of 60, the rows over, the
outcome, the verdict, and the findings, equal to what `a4 lint` reports for a
file holding that text. It SHALL write nothing.

#### Scenario: A page over
- **WHEN** a client checks text that lays out to 74 rows
- **THEN** the result says 74 of 60 rows, 14 over, the outcome fail, and the verdict Overflowing

#### Scenario: A noisy page
- **WHEN** a client checks text that fits but has 24% syntax overhead
- **THEN** the result's outcome is warn and its verdict is Noisy

### Requirement: Filing a letter
`write_letter` SHALL create a new draft letter holding the exact UTF-8 bytes of
`text` at `.agents/letters/<UTC YYYY-MM-DD-HHMM>-<topic>.md`, where the topic
defaults to "letter", and SHALL create `.agents/letters/` when it is missing.
It SHALL return the letter's path, its digest, and its check, and SHALL say
that the letter is a draft a person must seal before it is delivered.

#### Scenario: Filing a letter with a topic
- **WHEN** a client files 40 rows of text with the topic "auth-migration" at 09:30 UTC on November 25, 2026
- **THEN** `.agents/letters/2026-11-25-0930-auth-migration.md` holds exactly that text, and the result gives its digest and says it is a draft until a person seals it

#### Scenario: Filing a letter without a topic
- **WHEN** a client files a letter at 09:30 UTC on November 25, 2026 without a topic
- **THEN** it is filed as `.agents/letters/2026-11-25-0930-letter.md`

### Requirement: Only letters that fit are filed
When `text` uses more than 60 rows, `write_letter` SHALL write nothing and
SHALL return an error result with the rows over, the verdict, and the
findings, so the agent can rewrite it. A letter that fits but is Noisy or Busy
SHALL be filed, and the result SHALL give its verdict.

#### Scenario: A letter over the page
- **WHEN** a client files text that uses 63 rows
- **THEN** no file is written, and the error result says the letter is 3 rows over

#### Scenario: Exactly one page
- **WHEN** a client files text whose rows used is exactly 60
- **THEN** the letter is filed

#### Scenario: A noisy letter
- **WHEN** a client files text that fits but whose verdict is Noisy
- **THEN** the letter is filed, and the result gives the verdict Noisy

### Requirement: Never over another file
`write_letter` SHALL NOT replace or change an existing file. When the name is
taken, it SHALL add `-2` to `-9` after the topic, using the first free name,
including when another process creates the chosen name first. When all of
them are taken, it SHALL write nothing and return an error result.

#### Scenario: A second letter in the same minute
- **GIVEN** `.agents/letters/2026-11-25-0930-auth.md` exists
- **WHEN** a client files a letter with the topic "auth" at 09:30 UTC on November 25, 2026
- **THEN** it is filed as `.agents/letters/2026-11-25-0930-auth-2.md`, and the first letter's bytes are unchanged

#### Scenario: Every name taken
- **GIVEN** `2026-11-25-0930-auth.md` and `2026-11-25-0930-auth-2.md` through `-9.md` exist in `.agents/letters/`
- **WHEN** a client files a letter with the topic "auth" at 09:30 UTC on November 25, 2026
- **THEN** no file is written, and the result is an error

### Requirement: Topics
A topic SHALL be 1 to 40 characters: lowercase letters a to z, digits, and
hyphens. It SHALL start and end with a letter or digit and SHALL NOT hold two
hyphens in a row. For any other topic, `write_letter` SHALL write nothing and
return an error result.

#### Scenario: A path as a topic
- **WHEN** a client files a letter with the topic "../notes"
- **THEN** no file is written, and the result is an error

#### Scenario: Spaces and capitals
- **WHEN** a client files a letter with the topic "Auth Migration"
- **THEN** no file is written, and the result is an error

### Requirement: Text the desk won't take
When `text` is empty or only whitespace, or longer than 1 MiB (1,048,576
bytes) as UTF-8, `lint_page` and `write_letter` SHALL return an error result,
and `write_letter` SHALL write nothing.

#### Scenario: An empty letter
- **WHEN** a client files a letter whose text is "\n\n"
- **THEN** no file is written, and the result is an error

### Requirement: Reading the latest letter
Without arguments, `read_letter` SHALL deliver the letter `a4 letters --latest`
delivers: the newest accepted letter whose seal is intact. The letter's exact
text SHALL be in its own content block. The result SHALL also give the letter's
name, digest, signer, and time sealed, and a note for each newer returned
letter with its name and reason.

#### Scenario: A returned letter after an accepted one
- **GIVEN** an accepted letter, then a newer letter returned with the reason "Missing the rollback plan"
- **WHEN** a client calls `read_letter`
- **THEN** one content block is exactly the accepted letter's text, and the result notes the returned letter and "Missing the rollback plan"

### Requirement: Nothing to deliver
When no letter is accepted with its seal intact, `read_letter` SHALL return a
result that is not an error, says there is no letter to deliver, and holds no
letter's text.

#### Scenario: Only a draft and a broken seal
- **GIVEN** a draft letter, a letter whose seal is broken, and no other letters
- **WHEN** a client calls `read_letter`
- **THEN** the result says there is no letter to deliver and contains neither letter's text

### Requirement: Reading a letter by digest
Given a `digest` (`urn:a4:letter:sha256:` and 64 lowercase hexadecimal
digits), `read_letter` SHALL find the letter whose postmark or current bytes
have that digest. It SHALL return the text only when that letter is accepted
with its seal intact. Otherwise it SHALL give the letter's state, and the
reason for a returned letter, without text. When no letter matches, it SHALL
say so. A malformed digest SHALL be an error result.

#### Scenario: An accepted letter by digest
- **GIVEN** an accepted letter with digest D, and a newer accepted letter
- **WHEN** a client calls `read_letter` with digest D
- **THEN** a content block is exactly that letter's text

#### Scenario: A draft by digest
- **GIVEN** a draft letter filed by `write_letter`, which returned digest X
- **WHEN** a client calls `read_letter` with digest X
- **THEN** the result says the letter is a draft that hasn't been sealed, and doesn't contain its text

#### Scenario: An unknown digest
- **WHEN** a client calls `read_letter` with a well-formed digest that no letter has
- **THEN** the result says no letter has that digest

### Requirement: What the mailroom tells the agent
The `initialize` result SHALL carry instructions that tell the agent to file a
one-page letter with `write_letter` before it finishes a session or when its
context runs low, to check drafts with `lint_page` while rewriting, and that a
person seals a letter before it is delivered.

#### Scenario: The instructions
- **WHEN** a client sends `initialize`
- **THEN** the instructions name `write_letter` and `lint_page`, and say a person seals a letter before it is delivered

### Requirement: The letter prompt
`prompts/list` SHALL list one prompt, `letter`, with an optional `topic`
argument. `prompts/get` for `letter` SHALL return a user message that asks the
agent to write a handoff letter from the Handoff form, keep it within 60 rows,
and file it with `write_letter`, using the topic when one is given.

#### Scenario: Asking for a letter
- **WHEN** a client gets the prompt `letter` with the topic "auth"
- **THEN** the message holds the Handoff form, starting "HANDOFF ·", and asks the agent to file it with `write_letter` and the topic "auth"

### Requirement: Results for models and programs
Each tool result SHALL hold readable text for the model, and SHALL hold as
structured content, in proto3 JSON, an `a4.v1.PageCheck` (`lint_page`), an
`a4.v1.FiledLetter` (`write_letter`), or an `a4.v1.LetterDelivery`
(`read_letter`). The structured content of `lint_page` and `write_letter`
SHALL NOT contain the text that was checked.

#### Scenario: A secret in a checked page
- **WHEN** a client checks text containing the line "token: sk-test-123" with `lint_page`
- **THEN** the structured content does not contain "sk-test-123"

#### Scenario: A filed letter's record
- **WHEN** a client files a letter with `write_letter`
- **THEN** the structured content parses as an `a4.v1.FiledLetter` holding the letter's path, its digest, and its check

### Requirement: A readable note in every record
Each tool's record SHALL carry a `note`: the result's readable words for the
model, without any letter's text. Some clients show the model only the
structured content, and the note keeps the guidance in front of it there: that
a filed letter is a draft until a person seals it, and that a seal means a
person accepted a letter, not that it's true.

#### Scenario: Filing a letter
- **WHEN** a client files a letter with `write_letter`
- **THEN** the `FiledLetter`'s note gives the path and says the letter is a draft until a person seals it

#### Scenario: Delivering a letter
- **GIVEN** an accepted letter whose seal is intact
- **WHEN** a client calls `read_letter`
- **THEN** the `LetterDelivery`'s note names the signer and says a seal means a person accepted the letter, not that it's true, and the note doesn't contain the letter's text

#### Scenario: Checking a page
- **WHEN** a client checks text that lays out to 74 rows with `lint_page`
- **THEN** the `PageCheck`'s note says "74 of 60 rows, 14 over"

### Requirement: Protocol errors
A line that isn't valid JSON SHALL get JSON-RPC error -32700. An unknown method
SHALL get -32601. Calling an unknown tool, or getting an unknown prompt, SHALL
get -32602. Arguments that don't match a tool's input schema, and file system
failures, SHALL get an error result. Notifications SHALL get no response. The
mailroom SHALL keep serving after any error.

#### Scenario: A tool that doesn't exist
- **WHEN** a client calls the tool "seal_letter", and then calls `tools/list`
- **THEN** the first call gets error -32602, and `tools/list` is answered

#### Scenario: A malformed line
- **WHEN** a client sends a line that isn't JSON
- **THEN** it gets error -32700, and the mailroom keeps serving

### Requirement: Only its folder, and no network
The mailroom SHALL read files only inside its folder, SHALL create files only as
new letters in `.agents/letters/`, SHALL NOT change any existing file, and SHALL
NOT make any network request.

#### Scenario: The folder after a session
- **GIVEN** a folder of context files and letters
- **WHEN** a client checks a page, files a letter, and reads the latest letter
- **THEN** the only new file is the filed letter, and every other file's bytes and modification time are unchanged
