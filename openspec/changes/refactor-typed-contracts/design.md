# Design

## Context

- **Source:** the review (`docs/tech-debt-review.md`) gives file and line
  for every stringly typed contract this change replaces.
- **Prerequisites:**
  - fix-review-bugs is done first: it fixes B2 and B11 in the parsers this
    change makes mandatory.
  - add-code-guardrails is done first: its flags and lint rules catch casts
    added back by mistake.

## Goals / Non-Goals

**Goals:**
- Illegal states don't compile:
  - a file session can't follow a copy in its own store;
  - a lens without a style can't exist;
  - an attribute without a schema entry can't exist.
- Each contract is defined once and derived everywhere else.

**Non-Goals:**
- Behavior changes.
- File moves.

## Decisions

### 1. Brands and codecs

- **Parsers:** each brand has one exported parser, and the only cast lives
  inside it. Re-branding by `as` is forbidden by a review-metrics check
  (`scripts/cast-report.ts`), which counts `as <Brand>` outside parsers and
  fails above 0.
- **`IdCodec<Id> = { parse(s: string): Id | null; format(id: Id): string }`**
  is used by `Journal`, by remembered open refs, and by backends listing
  entries.

### 2. Errors

```ts
type StoreErrorMap = { "not-found": PageNotFoundError; exists: PageExistsError; conflict: PageConflictError; … };
function isStoreError<C extends keyof StoreErrorMap>(e: unknown, code: C): e is StoreErrorMap[C]
```

`PageConflictError.actual` is `Revision | null`, and every `expected` check
is `!= null`.

### 3. Sessions by policy

```ts
type RelocationPolicy<Id> =
  | { kind: "same-store"; store: PageStore }            // Id = PageName
  | { kind: "copy-out"; library: PageStore; libraryJournal: Journal<PageName>; copyName(id: Id, suffix: string): string };
```

- **Constructors:** `createLibrarySession(store, journal, page)` returns a
  `LibrarySession`, which has `rename`. `createFileSession(files, journal,
  page, copyOut)` returns a `PageSession<FilePath>`.
- **No casts:** the casts in session.ts and bootstrap.ts disappear.

### 4. The element contract

- **`ATTRIBUTES`** is a `const` table. Each entry is
  `{ name: "tilt", parse: number(0, 65, 32), serialize, default: 32 }`.
  - `observedAttributes` is `Object.values(ATTRIBUTES).map(a => a.name)`.
  - The React wrapper's `toAttributes(props)` iterates the table.
  - The `/element` docs table and SheetControls' slider ranges read it.
- **Events:** `A4SheetEventMap` maps `"a4-render"` to
  `CustomEvent<A4Render>`, and so on. The class declares
  `addEventListener<K extends keyof A4SheetEventMap>` overloads.
- **`types/a4-sheet.d.ts`** is generated from the table by a small script,
  so the JSX attribute types can't drift.

### 5. Analysis vocabulary

- **Findings:** `Finding` becomes data, for example
  `{ id: "overflow"; severity: "critical"; rows: number }` or
  `{ id: "repetition"; term: string; count: number; share: number }`, from
  a closed `FindingId`.
- **Copy:** `describeFinding(finding, format)` in
  `components/analysis-copy.ts` produces the current English text
  verbatim. A snapshot test over the sample pages proves it.
- **Verdicts:** `VerdictId` values are `"empty" | "overflowing" | …`, with
  a `VERDICT_LABEL` map. CSS keys on `data-tone`, derived in one map.

### 6. Settings and library events

- **Settings:** `defineSetting<T>({ key, codec, default })`. The registry is
  the only place that knows key strings. `useSetting(setting)` is
  `useSyncExternalStore` over storage events, plus an in-memory fallback.
- **Library events:** a `LibraryEvent` proto, posted as bytes. A receiver
  that gets a string treats `""` as `PagesChanged`, and any other value as
  `PageSaved(name)`, for one release, as noted in the README.

### 7. Model contract

- **`ErrorCode`:** an enum in `model.proto`. The TypeScript side uses the
  generated enum. `canceled` replaces `cancelled`, and an in-flight mapping
  accepts both for one release.
- **`RpcFrame`:** `oneof kind`. The transport replies with an error to any
  frame that has an id but can't be decoded.
- **`PluginId`:** a brand minted from registered cards only.

## Risks / Trade-offs

- **[Snapshot drift in finding copy]** → The snapshot test compares the
  output of `describeFinding` to the current strings before and after.
- **[Mixed-version tabs during deploy]** → Library events and error codes
  accept the old forms for one release.
- **[Generated d.ts]** → The generator runs in `pnpm check`. A diff fails
  CI, like `proto:check`.

## Migration Plan

No stored data changes. The proto changes regenerate `lib/gen/` and pass
`buf breaking`, because fields are added and old shapes stay accepted. The
one exception is `RpcFrame`, which is internal to a worker and its page and
always ships together; it is excepted from breaking checks with a note.
