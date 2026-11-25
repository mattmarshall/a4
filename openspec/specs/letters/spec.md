# letters Specification

## Purpose

One-page handoff letters between agent sessions and the people who review them.
An agent writes a letter into the repository, a person reads it on the page and
seals it, and the next session receives only sealed, accepted letters.

## Requirements

### Requirement: Where letters live
A letter SHALL be a `.md` file directly inside the folder's `.agents/letters/`
folder. Letters SHALL be ordered by file name without the `.md` extension, so
names that start with a UTC timestamp (`YYYY-MM-DD-HHMM-`) sort oldest to
newest. Files in subfolders of `.agents/letters/` SHALL NOT be letters.

#### Scenario: Two letters
- **GIVEN** `.agents/letters/` holds `2026-11-24-1700-auth.md` and `2026-11-25-0930-auth.md`
- **WHEN** the folder is listed
- **THEN** both are letters, and "2026-11-25-0930-auth.md" is the newest

#### Scenario: A second letter in the same minute
- **GIVEN** `.agents/letters/` holds `2026-11-25-0930-letter.md` and `2026-11-25-0930-letter-2.md`
- **WHEN** the folder is listed
- **THEN** "2026-11-25-0930-letter-2.md" is the newer of the two

#### Scenario: Not a letter
- **GIVEN** the folder holds `.agents/letters/old/2026-01-01-0000-x.md` and `docs/letter.md`
- **WHEN** the folder is listed
- **THEN** neither is a letter

### Requirement: The postmark
Sealing a letter SHALL write `<letter name>.postmark.json` beside it: an
`a4.v1.Postmark` in proto3 JSON holding the letter's file name, its digest, the
verdict (accepted or returned), the reason, the signer's name, the time it was
sealed (RFC 3339, UTC), and the parent digest. The letter's own bytes SHALL NOT
change.

#### Scenario: Accepting a letter
- **GIVEN** the draft letter `2026-11-25-0930-auth.md`
- **WHEN** the signer "Matt" accepts it
- **THEN** `2026-11-25-0930-auth.md.postmark.json` exists with verdict "LETTER_VERDICT_ACCEPTED", signer "Matt", and a `sealedAt` time ending in "Z", and the letter's bytes are unchanged

### Requirement: The digest
A postmark's digest SHALL be the SHA-256 of the letter file's exact bytes,
written as `urn:a4:letter:sha256:` followed by 64 lowercase hexadecimal digits.

#### Scenario: A known letter
- **GIVEN** a letter whose bytes are the UTF-8 text "abc"
- **WHEN** it is sealed
- **THEN** its digest is "urn:a4:letter:sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"

### Requirement: Letter states
A letter without a postmark SHALL be a **Draft**. A letter whose postmark reads
and whose digest matches its current bytes SHALL be **Accepted** or
**Returned**, as the postmark says. Any other letter with a postmark SHALL have
a **Broken seal**.

#### Scenario: Edited after sealing
- **GIVEN** an accepted letter
- **WHEN** another editor adds a line to it
- **THEN** the letter's state is Broken seal

#### Scenario: An unreadable postmark
- **GIVEN** a letter whose postmark file is not a valid `a4.v1.Postmark`
- **WHEN** the folder is listed
- **THEN** the letter's state is Broken seal

### Requirement: The parent
When a letter is sealed, its postmark's parent SHALL be the digest of the newest
accepted letter, with its seal intact, that sorts before it, or empty when there
is none.

#### Scenario: A chain of letters
- **GIVEN** `2026-11-24-1700-auth.md` is accepted with digest D
- **WHEN** `2026-11-25-0930-auth.md` is sealed
- **THEN** its postmark's parent is D

### Requirement: Postmarks are permanent
A4 SHALL NOT overwrite, change, or delete a postmark. Sealing a letter that
already has a postmark SHALL be refused, change nothing, and show the letter's
current state.

#### Scenario: Sealed in another tab
- **GIVEN** a draft letter open in two tabs
- **WHEN** one tab accepts it and then the other tab returns it
- **THEN** the second seal is refused, and the postmark still says accepted

### Requirement: The Letters group
When the open folder has letters, the folder section SHALL list them in a
**Letters** group above Context files, newest first. Each SHALL show its file
name, its state, and its rows used on the 80 × 60 Terminal grid, marked when
over 60. The search box SHALL filter letters by path.

#### Scenario: A sealed and a draft letter
- **GIVEN** an accepted letter and a newer draft
- **WHEN** the folder is listed
- **THEN** the Letters group shows the draft first, marked Draft, and then the letter marked Accepted

### Requirement: Comparing with the previous letter
Opening a letter that has an earlier letter SHALL show Compare, with the
previous letter (the one just before it by name) in slot A and the opened
letter in slot B, which becomes active. Opening the first letter SHALL open it
on its own.

#### Scenario: Opening the newest letter
- **GIVEN** letters "2026-11-24-1700-auth.md" and "2026-11-25-0930-auth.md"
- **WHEN** the user opens "2026-11-25-0930-auth.md"
- **THEN** Compare shows "2026-11-24-1700-auth.md" in A and "2026-11-25-0930-auth.md" in B

### Requirement: New letter
The Letters group, or the folder section when the folder has no letters, SHALL
offer **New letter**. It SHALL create a draft at
`.agents/letters/<UTC YYYY-MM-DD-HHMM>-letter.md`, numbered `-2` to `-9` if
that name is taken, holding the Handoff form, and open it.

#### Scenario: Starting a letter
- **WHEN** the user chooses New letter at 09:30 UTC on November 25, 2026
- **THEN** `.agents/letters/2026-11-25-0930-letter.md` is created with the Handoff form and opens on the sheet

### Requirement: Sealing a letter
On a draft letter, A4 SHALL offer **Seal…**, which saves pending edits and then
asks the person to **Accept** the letter or **Return** it. Return SHALL require
a reason. Accept SHALL be unavailable while the letter uses more than 60 rows.
Canceling SHALL write nothing.

#### Scenario: Returning a letter
- **WHEN** the person chooses Return with the reason "Missing the rollback plan"
- **THEN** the postmark says returned with that reason, and the letter is not delivered

#### Scenario: A letter over the page
- **GIVEN** a draft letter that uses 63 rows
- **WHEN** the person opens Seal…
- **THEN** Accept is unavailable and the dialog says the letter is 3 rows over

### Requirement: What a seal means
The seal dialog SHALL say that sealing records that the person read the letter
and accepts or returns it, and that it doesn't make the letter true. A4 SHALL
NOT show a seal, a verdict, or a signer as a trust score.

#### Scenario: The dialog's words
- **WHEN** the person opens Seal…
- **THEN** the dialog says a seal "doesn't make the letter true"

### Requirement: The signer
The first seal in a browser SHALL ask for the signer's name, and A4 SHALL
remember it in that browser for later seals, where it can be changed. A seal
SHALL NOT be written without a non-blank name.

#### Scenario: The second seal
- **GIVEN** the person sealed a letter as "Matt" earlier in this browser
- **WHEN** they open Seal… on another letter
- **THEN** the signer field already holds "Matt"

### Requirement: Accepting plays the fold
Accepting a letter in the 3D rendering SHALL play the letter fold after the
postmark is written. In the Flat rendering, or if the fold can't play, the seal
SHALL still be written.

#### Scenario: Accepting in Flat
- **GIVEN** the sheet renders flat
- **WHEN** the person accepts a letter
- **THEN** the postmark is written and no fold plays

### Requirement: Sealed letters are read-only
A letter with a postmark SHALL open read-only and SHALL say it is sealed, with
its verdict, signer, and time. The text SHALL be selectable and copyable, and
download and print SHALL work. No edit SHALL be saved to the file.

#### Scenario: Typing on a sealed letter
- **GIVEN** an accepted letter open on the sheet
- **WHEN** the person types a character
- **THEN** the text doesn't change and the file isn't written

### Requirement: Listing letters from the command line
`a4 letters [folder]` (the current directory by default) SHALL print one line
per letter, oldest first, with its state, its rows used out of 60, its file
name, and, when sealed, its signer and any reason, then exit with status 0.
With `--json`, it SHALL print only an `a4.v1.LetterList`, without letter text.

#### Scenario: Listing a folder
- **GIVEN** an accepted letter signed "Matt" and a returned one with the reason "Missing the rollback plan"
- **WHEN** the user runs `a4 letters`
- **THEN** both are listed with their states, and the returned letter's line includes "Missing the rollback plan"

### Requirement: Delivering the latest letter
`a4 letters --latest` SHALL print the exact text of the newest accepted letter
whose seal is intact, then a note for each newer returned letter with its name
and reason. With nothing to deliver, it SHALL print nothing on standard output,
say so on standard error, and exit with status 0.

#### Scenario: A returned letter after an accepted one
- **GIVEN** an accepted letter, then a newer letter returned with the reason "Missing the rollback plan"
- **WHEN** the user runs `a4 letters --latest`
- **THEN** it prints the accepted letter's text, followed by a note naming the returned letter and its reason

#### Scenario: Drafts and broken seals aren't delivered
- **GIVEN** a draft letter and a letter whose seal is broken, and no other letters
- **WHEN** the user runs `a4 letters --latest`
- **THEN** standard output is empty and the command exits with status 0

### Requirement: The letters command only reads
`a4 letters` SHALL NOT create, change, or delete any file, and SHALL NOT make any
network request. An unknown option SHALL print the usage and exit with status 2.

#### Scenario: Listing leaves the folder unchanged
- **WHEN** the user runs `a4 letters --latest` in a folder of letters
- **THEN** every file's bytes and modification time are unchanged afterward
