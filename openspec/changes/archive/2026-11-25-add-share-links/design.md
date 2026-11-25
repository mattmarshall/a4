# Design: add-share-links

## Context

See proposal.md for why, and the spec delta for behavior. The code this
builds on:

| Piece | Where | What changes |
| --- | --- | --- |
| The page record | `proto/a4/v1/sheet.proto`: `PageSpec { preset = 8, paper = 9, cols, rows, cell…, margin… }`, `Sheet { spec, text, grid }` | A link carries the preset and paper only: the rest is derived |
| The seal | `proto/a4/v1/letter.proto` (`Postmark`), `lib/desk/letters.ts` (`letterDigest` over exact bytes, `postmarkPath`, a private `parsePostmark`) | `parsePostmark` is exported, so the CLI can read a sidecar |
| Slots | `lib/workspace/slot-controller.ts`: a slot holds a library page or a folder file, each with a session; `SlotSnapshot.readOnly` is set for sealed letters | Unchanged: shared pages don't become a third slot kind |
| The page spec per slot | `components/Workbench.tsx`: `pageSpec(presetId, sizeOfName(label))` for A and B | In the shared view, the spec comes from the link |
| Export | `components/workbench/menus.tsx`: Copy page text through `navigator.clipboard.writeText` | Copy share link sits beside it |
| Hosting | The `hosting` spec: `/` and `/why`, and no page text on the server | Nothing changes: a link is `/` with a fragment |
| The CLI | `cli/a4.ts` dispatches; each command has its own module | `cli/share.ts` |

## Goals / Non-Goals

**Goals**
- **The link is the page.** No server, no expiry, and no copy anywhere but
  in the link.
- **Opening is reading.** Nothing in the reader's library, folders, or
  settings changes until they choose Save a copy.
- **A seal travels, but can't be planted.** The reader sees whether the text
  still matches its postmark. Nothing a link carries can make a letter
  accepted where an agent would deliver it.

**Non-Goals**
- **Hiding a link from the places URLs go.** That means browser history,
  chat logs, and extensions. The copy notice and the banner say that
  whoever holds the link can read the page.
- **Compatibility with links from before this change.** None exist.

## Decisions

### 1. The page format: `a4.v1.SharedPages`, in the fragment

`proto/a4/v1/share.proto`:

```proto
message SharedPages {
  repeated SharedPage pages = 1;   // one, or two for a pair (A then B)
}
message SharedPage {
  string name = 1;                 // the library name or the file's name, never its folder path
  Preset preset = 2;
  PaperSize paper = 3;
  bytes text = 4;                  // exact UTF-8 bytes, as stored
  Postmark postmark = 5;           // a sealed letter's, else unset
}
```

The link is `<origin>/#s1.` followed by
`base64url(deflate-raw(SharedPages))`, with no padding.

- **The fragment, not the query.** Browsers never send the fragment, so it
  never reaches the server or its logs. A query string would.
- **The preset and paper, not the whole `PageSpec` or `Sheet`.** The cell
  size, margins, and grid all follow from them. The grid alone would grow a
  full page's link many times over.
- **Bytes, not a string.** A letter's digest covers its file's exact bytes,
  including any byte-order mark, so the seal can be checked only against
  the bytes.
- **`s1.` is the format version.** An `s2.` link can mean something else
  later, and this version refuses it in words.
- **Raw DEFLATE** through `CompressionStream("deflate-raw")`. Browsers and
  Node share it, so no compression library is added.
- **Alternatives:**
  - Plain text in the fragment. It loses the preset, the size, and the seal,
    and isn't the project's record format.
  - JSON. It's larger, and it isn't the project default for records that
    cross a boundary.
  - An encrypted blob on the server. You chose the link; see the proposal.

### 2. Limits

- **A link is at most 16,384 characters.** That keeps a full Terminal page
  and its pair well inside what chat tools and mail keep intact. A
  4,800-character page of prose makes a link of about 3,000 characters.
- **Decompression stops at 1 MiB.** That's the same cap a file has in a
  folder. The decoder reads the stream in chunks and cancels it past the
  cap, so a crafted link can't fill memory.
- **One or two pages,** and each page's bytes must decode as strict UTF-8.

### 3. `lib/share/`: one codec for the app and the CLI

- **The modules:**
  - `link.ts` has `shareLink(pages, origin)` and `readLink(fragment)`.
  - `seal.ts` has `sealOf(page)`, which compares `letterDigest(bytes)` with
    the postmark.
- **No DOM or Node API,** so the same code runs in both places.
- **The layer** in `.dependency-cruiser.cjs` may use `page`, `gen`,
  `platform`, and `desk/letters.ts`.

### 4. The shared view is a Workbench mode, not a slot kind

A slot's job is to own a page's session and save it, and a shared page has
neither. So the Workbench keeps a `shared` state, read from the fragment on
load and on `hashchange`:

- **The reader's pages stay open underneath.** While `shared` is set, the
  stage gets read-only snapshots built from the link instead of the
  workspace's slots. Their specs come from the link's preset and paper.
  Close drops the state, and the reader's own pages show again, untouched.
- **Analysis works as usual.** It reads the text, so the verdict, metrics,
  Compare, and lenses all work. Fit to page and installed pens need a page
  ref, so they're unavailable until a copy is saved.
- **Opening a library page or a file** closes the shared view first.
- **Save a copy** creates each page through `createPage`, which already
  makes names unique, opens the copies, and closes the shared view.
- **Leaving the shared view,** by Close or Save a copy, removes the fragment
  with `history.replaceState`, so a reload doesn't reopen it.

**Alternative:** a `shared` slot kind in the workspace. Every `PageRef`
consumer would have to handle a page with no session, which is a wide change
for a read-only view.

### 5. Copy share link builds the link from what's shown

- **A library page or a file** is shared as the text on its sheet, encoded
  as UTF-8. Unsaved edits are included, as Copy page text does.
- **A sealed letter in a slot** is shared as its file's exact bytes and its
  postmark. A new workspace read, `letterForShare(slot)`, takes them from
  the folder, bounded at 1 MiB, so the reader can check the seal.
- **A draft letter** has no postmark, so it's shared as a page.
- **The name** is the library name or the file's name, without its folder
  path.

### 6. A link can't plant a seal

A postmark is a record, not a signature, and anyone can write one into a
link with a digest that matches. So:
- **The shared view** says what a seal means: the named person accepted or
  returned the letter, not who sent the link.
- **Save a copy** creates a library page, never a letter.
- **`a4 open`** writes only the text, never a `.postmark.json`.

This way a link can't add an "accepted" letter to a repository, where
`a4 letters --latest` would hand it to an agent as instructions.

### 7. The commands

- **`a4 share <file> [<file>]`** reads each file (1 MiB cap), takes its size
  from its name, and uses the Terminal preset. If
  `<file>.postmark.json` sits beside it, it's parsed with the desk's postmark
  check and carried. The link's origin is the production domain from the
  `hosting` spec.
- **`a4 open <link> [--out <folder>]`** reads a full link or just its
  fragment.
  - **File names:** each name is made safe. Path separators, control
    characters, and leading dots are replaced, and `.md` is added unless it
    ends in `.md` or `.mdc`.
  - **All or nothing:** every target is checked before any file is
    written, so a pair is never half-written.
  - **Seals:** it prints each letter's seal state with the same words as
    the app.

## Risks / Trade-offs

- **[Risk] A link lives wherever URLs go:** history, chat logs, and
  extensions.
  - The copy notice and the banner say whoever holds the link can read the
    page.
  - Leaving the shared view removes the fragment from the address bar.
  - A link preview fetches `/` without the fragment, so it learns nothing.
- **[Risk] A crafted link.**
  - The decoder caps decompression at 1 MiB and checks the protobuf, the
    page count, and the UTF-8.
  - Page text renders as text on the sheet, and names render through React.
  - `a4 open` cleans file names and never overwrites.
- **[Risk] A forged seal.** See Decision 6. Nothing a link carries becomes a
  postmark.
- **[Trade-off] Long links.** Some tools wrap or cut long URLs. The 16,384
  cap, and the size shown in the copy notice, keep it visible.
- **[Risk] A browser without `CompressionStream`.** Every browser A4 supports
  has had it since 2023 (Safari 16.4). Without it, A4 says this browser
  can't open share links, and opens normally.

## Migration Plan

- **Nothing to migrate.** Links are new.
- **Rollback:** reverting leaves links that open as the plain workbench,
  because an unknown fragment is ignored.
