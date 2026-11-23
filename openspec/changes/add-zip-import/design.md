# Design

## Context

See proposal.md. Export already writes zips with `lib/zip.ts`. Pages are
created through the `PageStore` contract, so import must not assume a
backend.

## Goals / Non-Goals

**Goals:**

- Read zips made by A4, Info-ZIP `zip`, macOS Finder or `ditto`, Windows
  Explorer, and Python `zipfile`.
- Treat the archive as untrusted input.

**Non-Goals:**

- Zip64, encryption, multi-disk archives, and compression methods other than
  stored (0) and deflate (8).

## Decisions

### Read from the central directory

`lib/unzip.ts` finds the end-of-central-directory record by scanning backward
over at most 64 KB of trailing comment, then walks the central directory. Sizes
and CRCs come from the central directory, so entries written with data
descriptors (general-purpose bit 3, used by streaming writers) work. Each
entry's data offset is taken from its local header, whose name and extra
lengths may differ from the central copy. Entries are inflated lazily, only if
the import decides it wants them.

### Untrusted-input guards

Applied before any inflation:

- Reject archives with more than 5,000 entries.
- Reject archives that declare more than 50 MB uncompressed in total.
- Skip any entry that declares more than 1 MB uncompressed.
- Reject Zip64 markers (`0xFFFF` / `0xFFFFFFFF`).
- Treat out-of-bounds offsets as a corrupt archive.

During inflation:

- The output stream is cut off as soon as it exceeds the declared size, which
  stops decompression bombs that lie in their headers.
- The CRC-32 is verified.
- Encrypted entries (bit 0) are skipped.

### File names

Names flagged UTF-8 (bit 11) are decoded as UTF-8. Unflagged names are tried
as strict UTF-8 first, because macOS and many Linux tools write UTF-8 without
setting the flag. Names that fail are decoded as Windows-1252, the closest
`TextDecoder` label to the spec's CP437 for the characters that matter.

The page name is the file's basename without `.md` or `.txt`, passed through
`sanitizePageName`. Folders are flattened.

### Collision policy

The import lists the library once and tracks every name it uses. For each page
file, in archive order:

| Situation | Outcome |
| --- | --- |
| No page with this name | Create the page. |
| A page with this name and identical normalized text | Skip as unchanged. |
| A page with this name and different text, or an earlier file in this archive took the name | Create under the next free name ("Brief 2") and report it as renamed. |

Existing pages are never written, so "no work is lost" holds even for a
mistaken import.

### Text

The bytes are decoded as UTF-8, and a leading byte-order mark is removed. The
text is then normalized with `normalizeText`, the function paste uses. A NUL
byte marks the file as binary, and it is skipped.

## Risks / Trade-offs

- [An archive from an unusual tool fails to parse] → Tests cover A4's own
  exporter, Info-ZIP with forced data descriptors, `ditto`/Finder archives
  with `__MACOSX`, and Python `zipfile`. Failures produce a clear message and
  leave the library unchanged.
- [A partial import after an unexpected store error] → Pages created before
  the error remain (they are new pages, so nothing is lost), and the report
  says how far the import got.
