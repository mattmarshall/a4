# Proposal

## Why

A page is meant to travel: a person hands a teammate a context page to
review, or an agent hands a person a letter to read. Today the only ways out
are copying the text, downloading a file, or exporting a zip, and the reader
then rebuilds the page by hand. concept.md parked share links until the page
format was decided. This change makes that decision: a link carries the page
itself, as an `a4.v1` protobuf, in the part of the URL a browser never sends
to the server. So A4's hosting rule still holds: the server never stores or
logs page text.

## What Changes

- **The page format for sharing.** A link carries one or two pages as an
  `a4.v1.SharedPages` message, compressed and base64url-encoded in the URL's
  `#` fragment, after a version prefix (`#s1.`). Each page carries:
  - its name;
  - its page spec (preset and paper size);
  - its text as exact UTF-8 bytes;
  - for a sealed letter, its postmark.

  The full grid isn't sent: it's derived from the text. A link is at most
  16,384 characters, and a page too large for one is refused with a pointer
  to Download.
- **Sharing from the app.** The Page menu gains Copy share link. In Compare,
  it can share A and B as a pair. The link goes to the clipboard, as an
  explicit export like Copy page text, with a note that anyone holding it can
  read the page.
- **Opening a link.** A4 opens in a shared view, with nothing stored:
  - The pages show read-only on their sender's preset and size, with their
    verdicts, lenses, and analysis.
  - A banner names the pages, says they aren't saved, and offers Save a copy
    and Close.
  - Save a copy adds each page to the reader's library under a name that
    never replaces one they have.
  - A pair opens in Compare.
- **Letters keep their seal.** A sealed letter's link carries its postmark.
  The shared view says whether the text still matches the postmark's digest,
  and who sealed it and how. It also says plainly that a link's seal records
  someone's acceptance, and doesn't prove who sealed it. Saving or opening a
  shared letter never writes a postmark, so a link can't make a letter
  accepted in anyone's repository.
- **`a4 share` and `a4 open`.**
  - `a4 share <file> [<file>]` prints a link to one page or a pair, with a
    letter's postmark when it has one.
  - `a4 open <link>` writes each page to a new file, never overwriting one,
    and reports a letter's seal without writing it.
  - Neither makes a network request.

### Out of scope

- Short links, or any copy of a page on a server, encrypted or not.
- Editing a shared page in place. A reader edits a copy they saved.
- Links to a whole stack, the library, or more than two pages.
- Expiring or revoking a link. A link is the page: whoever has it can read it.
- Signed shares. A postmark in a link identifies, and doesn't authenticate,
  as in a repository.
- Share links in the mailroom (MCP). An agent can run `a4 share`.

## Capabilities

### New Capabilities

- `share-links`: The share-link format (`a4.v1.SharedPages` in the URL
  fragment) and its limits; sharing a page or a pair from the app; the
  read-only shared view and Save a copy; a shared letter's seal; and
  `a4 share` and `a4 open`.

### Modified Capabilities

None. Page text still never reaches the server (hosting), and the app's
routes are unchanged: a link opens the workbench at `/` with a fragment.

## Impact

- **Protos:** `proto/a4/v1/share.proto` adds `SharedPages` and `SharedPage`.
  It reuses `PageSpec` (sheet.proto) and `Postmark` (letter.proto).
- **Core:** `lib/share/`, a new layer for the link codec. It builds and
  reads links, with no DOM or Node API, through `CompressionStream` and
  `DecompressionStream` (deflate-raw), so the app and the CLI share it.
  `.dependency-cruiser.cjs` gains the layer.
- **Workspace:** a read of a sealed letter's exact bytes and postmark for a
  slot, so its link can carry a checkable seal.
- **UI:**
  - The Page menu gains Copy share link.
  - `components/Workbench.tsx` gains a shared mode: read-only slots fed
    from the link, a banner with Save a copy and Close, and the seal line.
- **CLI:** `cli/share.ts` with `a4 share` and `a4 open`, and the usage text.
- **Docs:** a README section, "Share links". concept.md and
  `docs/platform.md` record the decision, and share links become roadmap
  step 6.
- **Hosting:** none. A link is `https://a4.marsh.build/#s1.…`, and the
  fragment never leaves the browser.
