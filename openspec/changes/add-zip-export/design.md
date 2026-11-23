# Design

## Context

See proposal.md. Pages are read through the `PageStore` contract (`list` +
`read`). The export works the same on every backend.

## Goals / Non-Goals

**Goals:**

- A standard zip that common tools open, built without a new dependency.

**Non-Goals:**

- Zip64 (libraries are far below 4 GB and 65,535 entries).
- Encryption.
- Streaming very large archives.

## Decisions

### A small zip encoder in `lib/zip.ts`

The format needed here is small:

- A local header and data for each entry.
- A central directory.
- An end-of-central-directory record.

Each entry gets a CRC-32, DOS date and time from the page's modified time, and
general-purpose bit 11 for UTF-8 names. Data is compressed with the built-in
`CompressionStream("deflate-raw")` (method 8), which every browser A4 targets
and Node both support. If it is unavailable, or compression would not shrink
the data, the entry is stored uncompressed (method 0).

Alternative: `fflate` or `JSZip`. Rejected because it adds about 10 to 100 KB
and a dependency for roughly 150 lines of well-specified code.

### Archive layout

`a4-pages-<date>/<page name>.md`. A top-level folder keeps extraction tidy.
Page names already exclude `/ \ : * ? " < > |` and control characters, so
the entry names are valid on Windows, macOS, and Linux. Duplicate names can't
occur, because names are unique ignoring case.

### Flush first

The export calls `flushAll()` on the open sessions before listing pages, the
same path as Ctrl/Cmd+S.

## Risks / Trade-offs

- [A hand-written encoder could produce archives some tools reject] → Tests
  round-trip every entry through an independent reader, and the archive is
  checked with `unzip -t` and Python's `zipfile` before shipping.
- [Archives are built in memory] → Pages are a few KB each, so even thousands
  of pages stay in the low megabytes.
