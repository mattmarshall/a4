# Proposal: add-letters

## Why

Handoffs between agent sessions are invisible. A long session compacts into a
summary nobody reads, and the next session starts from a log. `docs/platform.md`
makes **Letters** A4's killer app: every session ends with a one-page letter, a
person reads it in two minutes and seals it, and the next session starts from
it.

The headless desk (`add-headless-desk`) already judges a page outside the
browser. This change adds roadmap step 2: the letter itself, the seal, the
inbox where people review letters, and a plain way for the next session to
receive them.

## What Changes

- **Letters on disk.** A letter is a Markdown file in a repository's
  `.agents/letters/` folder, named so that sorting by name sorts by time
  (`2026-11-25-0930-auth-migration.md`). Any agent or editor can write one; it
  is plain text, and its body is exactly the page.
- **The postmark.** Sealing writes `<letter>.postmark.json` beside the letter.
  It is an `a4.v1.Postmark` in proto3 JSON (new `proto/a4/v1/letter.proto`)
  and records:
  - the letter's sha256 digest as a URN (`urn:a4:letter:sha256:<hex>`), over
    its exact bytes;
  - the verdict, **Accepted** or **Returned**, and a reason (required to
    return);
  - the signer's name and the time (RFC 3339);
  - the parent: the digest of the previous accepted letter.

  A4 never overwrites or deletes a postmark, and never changes a sealed
  letter.
- **Letter states.**
  - **Draft:** no postmark.
  - **Accepted** or **Returned:** a postmark whose digest matches the
    letter's bytes.
  - **Broken seal:** the letter changed after it was sealed, or the postmark
    can't be read.
- **A Letters group in the folder view.**
  - It sits above Context files, newest first, and shows each letter's state
    and its rows out of 60.
  - Opening a letter puts the previous letter in A and this one in B in
    Compare.
  - **New letter** creates a draft from the Handoff form.
- **Sealing.**
  - On a draft letter, **Seal…** opens a dialog: Accept, or Return with a
    reason.
  - The first seal asks for the signer's name, which this browser remembers.
  - Accepting plays the letter fold in 3D.
  - A sealed letter opens read-only. "A seal is acceptance, not truth": the
    dialog says so, and a seal is never shown as a trust score.
- **A read-only sheet.** `<a4-sheet>` gains a `readonly` attribute: the text
  can be selected and copied, but not edited.
- **Delivery from the command line.**
  - `a4 letters [folder]` lists letters with their state, rows, verdict, and
    reason.
  - `a4 letters --latest` prints the text of the latest accepted letter whose
    seal is intact. It then adds a short note for each letter returned since,
    with its reason. A plain session-start hook can deliver letters with it,
    before the mailroom exists.
  - `--json` prints an `a4.v1.LetterList`, which has no letter text.
- **Lint checks letters.** `a4 lint` checks letters as well as context files,
  since a letter must fit one page.

## Capabilities

### New Capabilities

- `letters`: one-page handoff letters in `.agents/letters/`. It covers:
  - naming and order;
  - the postmark sidecar and its digest;
  - the states (draft, accepted, returned, broken seal);
  - sealing (Accept or Return, the signer, the fold, read-only once sealed);
  - the folder view's Letters group, and Compare against the previous letter;
  - New letter;
  - delivery through `a4 letters` and `a4 letters --latest`.

### Modified Capabilities

- `folder-pages`:
  - "Other Markdown and skipped folders": letters are listed in their own
    group, not under Other Markdown.
  - "Creating files on request": New letter and sealing (the postmark) are the
    only other times A4 creates a file.
- `page-lint`: "Which files are checked" adds letters in `.agents/letters/`.
- `a4-sheet-element`: a new "Read-only sheets" requirement for the `readonly`
  attribute.

## Impact

- **New code:**
  - `proto/a4/v1/letter.proto` and its generated code;
  - `lib/desk/letters.ts` (digest, states, listing, delivery, sealing on a
    `FolderFs`);
  - a seal dialog and the Letters group in `components/`;
  - an `a4 letters` command in `cli/a4.ts`.
- **Changed code:**
  - `lib/persist/folder/scan.ts` (a letter group);
  - `lib/workspace/` (seal under the folder's lock, read-only sealed letters,
    New letter);
  - the sheet element's attribute table and generated types;
  - `lib/persist/settings.ts` (the signer's name);
  - `.dependency-cruiser.cjs` (workspace may use desk).
- **Dependencies:** none. SHA-256 comes from Web Crypto (`crypto.subtle`), in
  both the browser and Node.
- **Privacy:** everything stays on the device, as before.

## Out of Scope

- **The mailroom MCP server and session hooks** (`write_letter`,
  `read_letter`, a fit loop for agents), which are roadmap step 3. This change
  delivers letters through `a4 letters --latest` only.
- **Cryptographic signatures or verified identity.** The signer is a name the
  person typed; it identifies but doesn't authenticate.
- **Anything an outside system needs.** No routing, review queues, or ledgers
  are included.
- **Letters outside `.agents/letters/`,** nested folders inside it, and
  library-only letters. Letters live in a repository folder.
- **Editing a sealed letter, unsealing, or deleting postmarks.** A sealed
  letter is final. A new draft is the way to say something new.
- **Live listing of newly arrived letters.** The folder list refreshes when
  the tab becomes visible again or after A4 creates or seals a file, as it does
  today.
- **The fold ladder** (A5 cards, A6 postcards) and stacks.
