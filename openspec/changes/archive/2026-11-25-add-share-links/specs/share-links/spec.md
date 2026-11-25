# Spec Delta

## Purpose

Lets a person or an agent hand someone a page, or a pair of pages, as a link
that carries the page itself, so it opens read-only in A4 without the page
ever reaching a server.

## ADDED Requirements

### Requirement: The link format
A share link SHALL be the workbench URL with a fragment of `s1.` followed by
an `a4.v1.SharedPages` message, compressed with raw DEFLATE and encoded as
base64url without padding. It SHALL carry one or two pages, each with its
name, preset, paper size, and text as exact UTF-8 bytes, and for a sealed
letter, its postmark.

#### Scenario: A page survives the round trip
- **WHEN** the author shares an A5 page named "Deploy note.a5" on the Pica preset, and a reader opens the link
- **THEN** the reader sees "Deploy note.a5" on Pica A5 with the same text, byte for byte

### Requirement: The page never reaches the server
Making or opening a share link SHALL send no page text to any server. The page
SHALL travel only in the URL's fragment, which browsers don't send.

#### Scenario: Opening a link
- **WHEN** a reader opens `https://a4.marsh.build/#s1.…`
- **THEN** the only request to the server is for `/` and the app's files, and no request carries the page text

### Requirement: Link length
A share link SHALL be at most 16,384 characters. Sharing a page or pair whose
link would be longer SHALL be refused, with a suggestion to download the page
instead, and nothing SHALL be copied.

#### Scenario: A page too large for a link
- **WHEN** the author shares a page of 40,000 characters that don't compress
- **THEN** A4 says the page is too large for a link and suggests Download, and the clipboard is unchanged

### Requirement: Reading a link
A link SHALL be refused, with a notice and nothing stored, when its version
prefix isn't `s1.`, when it can't be decoded, when it decompresses past 1 MiB,
when it holds no page or more than two, or when a page's text isn't valid
UTF-8. The workbench SHALL then open as it would without the link.

#### Scenario: A link from a newer A4
- **WHEN** a reader opens a link whose fragment starts with `s2.`
- **THEN** A4 says the link was made by a newer A4, and opens the reader's own pages

#### Scenario: A payload that decompresses too far
- **WHEN** a reader opens a link whose payload decompresses to 2 MiB
- **THEN** A4 stops reading at 1 MiB, says the link can't be opened, and stores nothing

### Requirement: Copy share link
The Page menu SHALL offer Copy share link for the active page. It SHALL put
the link on the clipboard, as an explicit export like Copy page text, and
say that anyone with the link can read the page.

#### Scenario: Sharing a page
- **WHEN** the author chooses Copy share link on "Charter"
- **THEN** the clipboard holds a link that opens "Charter", and A4 says anyone with the link can read it

### Requirement: Sharing a pair
In Compare, Copy share link SHALL also offer to share pages A and B together.
A pair's link SHALL open both pages in Compare, A as A and B as B.

#### Scenario: A page and its rewrite
- **GIVEN** Compare shows "Brief" as A and "Brief (fit)" as B
- **WHEN** the author shares A and B, and a reader opens the link
- **THEN** the reader sees Compare with "Brief" as A and "Brief (fit)" as B

### Requirement: The shared view
Opening a link SHALL show its pages read-only on their sender's preset and
size, with their verdicts, metrics, and lenses. A banner SHALL name the pages
and say they're shared and not saved, and offer Save a copy and Close.

#### Scenario: Typing on a shared page
- **GIVEN** a reader opened a shared page
- **WHEN** they type on the sheet
- **THEN** the text doesn't change, and the banner still offers Save a copy

### Requirement: Nothing is stored until Save a copy
Opening a link SHALL NOT create, change, or delete any page, file, or setting.
Close SHALL return the reader to the pages they had open and remove the
fragment from the address bar.

#### Scenario: Opening and closing a link
- **GIVEN** a reader's library has 6 pages, and "Notes" is open
- **WHEN** they open a share link and then choose Close
- **THEN** the library still has 6 pages, and "Notes" is open again

### Requirement: Save a copy
Save a copy SHALL add each shared page to the reader's library under its own
name, with a numeric suffix when that name is taken, and open the copies.
It SHALL never change an existing page, and it SHALL leave the shared view
and remove the fragment.

#### Scenario: A name the reader already has
- **GIVEN** the reader's library holds "Brief"
- **WHEN** they open a shared page named "Brief" and choose Save a copy
- **THEN** "Brief" is unchanged, and a new page "Brief 2" holds the shared text and is open

### Requirement: A shared letter's seal
A sealed letter's link SHALL carry its postmark. The shared view SHALL show
the verdict, the signer, the reason, and when it was sealed. It SHALL also
say whether the SHA-256 digest of the shared bytes matches the postmark: the
seal is intact, or it's broken because the letter changed after it was
sealed.

#### Scenario: An intact seal
- **WHEN** a reader opens a link to a letter that Matt accepted, unchanged since
- **THEN** the shared view says Matt accepted it and the seal is intact

#### Scenario: A changed letter
- **WHEN** a reader opens a link whose letter bytes don't match its postmark's digest
- **THEN** the shared view says the seal is broken: the letter changed after it was sealed

### Requirement: What a link's seal means
The shared view SHALL say that a seal records that the named person accepted
or returned the letter, that it doesn't prove who sealed it or make the letter
true, and that anyone can make a link. Saving or opening a shared letter SHALL
never write a postmark.

#### Scenario: Saving a sealed letter
- **WHEN** a reader saves a copy of a shared, sealed letter
- **THEN** the copy is a library page with no postmark, and no letter in any folder becomes sealed

### Requirement: Sharing from the command line
`a4 share <file> [<file>]` SHALL print a share link to one page or a pair.
Each page's size comes from its name and its preset is Terminal. A letter
with a postmark beside it SHALL carry it. It SHALL exit 1 when the link would
be too long, 2 for a usage error or a missing file, and make no network
request.

#### Scenario: Sharing the latest letter
- **GIVEN** `.agents/letters/2026-11-25-0930-auth.md` is accepted, with its postmark beside it
- **WHEN** an agent runs `a4 share .agents/letters/2026-11-25-0930-auth.md`
- **THEN** it prints one `https://a4.marsh.build/#s1.` link that opens the letter with its intact seal, and exits 0

### Requirement: Opening from the command line
`a4 open <link> [--out <folder>]` SHALL write each page to a new file named
after it, in the current folder or `--out`. It SHALL never overwrite a file
and exit 2 if one exists. It SHALL print a letter's seal state, never write a
postmark, exit 1 for a link it can't read, and make no network request.

#### Scenario: A file that exists
- **GIVEN** `Charter.md` exists in the current folder
- **WHEN** the person runs `a4 open` on a link to a page named "Charter"
- **THEN** `Charter.md` is unchanged, and the command names it and exits 2

#### Scenario: Opening a sealed letter's link
- **WHEN** the person runs `a4 open` on a link to an accepted letter
- **THEN** the letter's text is written to a new file, its seal state is printed, and no `.postmark.json` file is written
