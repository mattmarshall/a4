# Proposal

## Why

Many of A4's contracts are plain strings. The review
(`docs/tech-debt-review.md`) lists them:
- **Storage (S1–S4):** brands minted by casts, errors identified by string
  codes, and the session kind guessed with `as unknown as`.
- **Element and lenses (E1, E2, E5, E6):** event names and details, the
  attribute names and ranges copied in four places, and lens styles as free
  strings.
- **Analysis (A1, A2, A6):** verdicts used as ids and CSS selectors, findings
  as prose, and lens and preset ids not tied to their tables.
- **UI (U6, U7):** settings read by any string key, and a cross-tab message
  that is a bare string.
- **Models (M6, M7, M11):** error codes as strings on the wire, `RpcFrame`
  driven by flags and a magic method name, and plugin ids as plain strings.

A rename or a typo in any of these compiles, then fails silently. Typing
them first makes the next refactors safe to do by moving code, because the
compiler checks every call site.

## What Changes

- **Brands come only from parsers:**
  - `PageName`, `FilePath`, `TrashId`, and `Revision` are minted by their
    parsers.
  - Backends and the journal parse stored strings, or skip invalid entries.
  - `Journal<Id>` takes an `IdCodec<Id>`.
  - A revision that isn't known is `null`, never `""`.
- **Discriminated store errors:** `isStoreError(e, "conflict")` narrows to
  `PageConflictError`, and the base error constructor is protected.
- **Sessions by kind:**
  - `PageSession` takes a `RelocationPolicy<Id>`: `same-store` with a
    `PageStore`, or `copy-out` with the library, its journal, and a copy
    name.
  - `rename` exists only on `LibrarySession`.
  - `recoverDrafts` takes the same policy.
  - `Recovery` becomes a discriminated union.
- **The element contract**, in `lib/element/contract.ts`:
  - `A4_EVENTS`, `A4SheetEventMap`, and typed `addEventListener`
    overloads.
  - An `HTMLElementTagNameMap` entry.
  - One `ATTRIBUTES` table (name, parse, serialize, default, range) that
    drives `observedAttributes`, the React wrapper's attribute mapping, the
    docs page table, and SheetControls' ranges.
  - `parseLensAttr` and a `modelLens(name)` helper.
- **The page and analysis vocabulary:**
  - `LensId`, `PresetId`, and their tables declared once with
    `as const satisfies`, ids derived from the tables, and `assertNever` in
    switches.
  - A `SegmentStyle` union instead of class strings.
  - `heatLevel` returns `0 | 1 | 2 | 3 | 4`.
  - `VerdictId` (lowercase ids, with labels in a map).
  - `Finding` as a discriminated union of data. `describeFinding()` writes
    the English copy in the UI layer.
- **Typed settings:** a `Setting<T>` registry in `lib/settings.ts` (key,
  codec, default) and a `useSetting` hook. It covers view settings, panels,
  inspector sections, and open refs, keeps the legacy `mode=paper`
  migration, and replaces `readKey(string)`.
- **Library events as protobuf:** `proto/a4/v1/library_event.proto`
  (`LibraryEvent { oneof { PagesChanged, PageSaved{name} } }`) replaces the
  bare-string BroadcastChannel message. Receivers still accept the old string
  for one release.
- **Model contract types:**
  - An `ErrorCode` enum in `model.proto` (`CANCELED`, `NOT_FOUND`,
    `INVALID_CARD`, …), and `isModelError(e, code?)`.
  - `RpcFrame` becomes a `oneof` (call, cancel, message, end, error), with
    an error reply for any undecodable frame that has an id.
  - A branded `PluginId`.

## Capabilities

### New Capabilities

### Modified Capabilities

(None: behavior is unchanged, so `skip_specs` is set.)
- Stored formats are kept: localStorage keys and values, OPFS paths, and
  IndexedDB.
- The element's attributes and events keep their names and values.
- The cross-tab channel still accepts the old string.

## Impact

- **Libraries:** `lib/store/`, `lib/autosave/`, `lib/folder/`,
  `lib/element/`, `lib/lenses.ts`, `lib/page-spec.ts`, `lib/analyze.ts`,
  `lib/paper/texture.ts`, `lib/storage.ts`, and `lib/models/`.
- **UI:** `components/` (A4Sheet, Workbench, MetricsPanel, ComparePanel,
  SheetControls, useLibrary, InspectorSection), `app/element/page.tsx`, and
  `types/a4-sheet.d.ts`.
- **Contracts and styles:** `proto/a4/v1/` (new `library_event.proto`;
  `model.proto` changes), `lib/gen/` (regenerated), and
  `app/globals.css` (verdict selectors become `data-tone`).
- **Gone:** `as unknown as` drops from 15 to the few documented in one place
  (worker scope typing), and every `as PageName` outside a parser is
  removed.

## Out of scope

- Moving files into new folders: refactor-lib-layout.
- The workspace controller: refactor-workspace-controller.
- Model plugin manifest and capability changes beyond the error enum and
  frame: refactor-model-plugins.
