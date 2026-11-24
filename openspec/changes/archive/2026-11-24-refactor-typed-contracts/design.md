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
- **As built:**
  - The `HTMLElementTagNameMap` entry sits beside the class in
    `a4-sheet.ts`. In `contract.ts` it would need a type import of the class,
    a cycle the import-boundary rules reject.
  - `light` wraps into 0–360 instead of clamping to −360–720. The slider
    keeps its 0–360 range, and an azimuth of 400 lights the page exactly
    like 40.

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
  `useSyncExternalStore` over this tab's setting writes, plus an in-memory
  fallback.
  - **Same tab only:** it doesn't follow `storage` events from other tabs.
    Live cross-tab settings would change behavior (switching one tab to
    Compare would switch every tab), which this change avoids. Other tabs
    read new values when they load, as before.
  - **Hook placement:** `lib/settings.ts` holds the registry and storage;
    the hook lives in `components/useSetting.ts`, because `lib/` stays
    free of React.
  - **The Workbench:** it keeps reading settings once after mount and
    writing them on change, now through `readSetting` and `writeSetting`.
    Moving its state into `useSetting` belongs to
    refactor-workspace-controller. An unset Pages panel or inspector still
    follows the window width.
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
- **As built:**
  - **Where the frame lives:** `RpcFrame` and `RpcError` moved to their own
    file, `rpc.proto`, which `buf.yaml` exempts from breaking checks.
    Under buf's FILE rules, the move deletes two messages from
    `model.proto`. A second exception allows exactly that rule
    (`MESSAGE_NO_DELETE`) on `model.proto`, with a note to remove it once
    this change has shipped.
  - **Error codes:** `ErrorCode` also names registration problems
    (`NOT_FOUND`, `INVALID_CARD`), so they no longer reuse result codes.
    `UNREADABLE` is the code for a frame that can't be decoded.
  - **The old spelling:** `errorCodeFromName` maps both spellings of
    canceled, and `toModelError` uses it for errors that carry a string
    `code`. The page and its worker always ship together, so the wire
    itself carries only the enum.
  - **Undecodable frames:** a request that can't be decoded gets an error
    reply. On the client, a reply that can't be decoded fails its call.
  - **Plugin ids:** the host's `register` returns the `PluginId`, and each
    bundled card's module mints its own constant from its card.
  - **Double casts:** seven `as unknown as` remain, each listed in
    `scripts/cast-report.ts` with its reason. They are the worker scope (two
    in the semantic worker), the Anthropic SDK boundary (two in the
    adapter), and three test fakes. `navigator.locks`, the method
    descriptors, the directory picker, and the test ports now type without
    one.

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
always ships together; it is excepted from breaking checks with a note
(`buf.yaml`). After this change ships, remove the `MESSAGE_NO_DELETE`
exception for `model.proto`.
