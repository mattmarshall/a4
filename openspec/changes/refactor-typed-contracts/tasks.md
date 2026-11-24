# Tasks

## 1. Storage types

- [x] 1.1 Make brands mintable only by their parsers, add `IdCodec<Id>` to `Journal` and backend listing, and add `scripts/cast-report.ts` (fails on `as <Brand>` outside parsers). Verify that `pnpm test` passes and the cast report shows 0
- [x] 1.2 Add the discriminated store errors (`StoreErrorMap`, protected base, `actual: Revision | null`, `expected != null`). Verify that the folder tests no longer cast after `isStoreError`, and all tests pass
- [x] 1.3 Add `RelocationPolicy`, `LibrarySession`, and `createFileSession`; make `recoverDrafts` take the policy; make `Recovery` a union. Verify that session.ts and bootstrap.ts have no `as unknown as`, and the autosave tests pass unchanged in behavior

## 2. Element contract

- [x] 2.1 Add `lib/element/contract.ts` (`ATTRIBUTES`, `A4_EVENTS`, `A4SheetEventMap`, tag-name map, `parseLensAttr`, `modelLens`), and make the element, the wrapper, SheetControls, and the docs page read it. Verify that the element tests pass, and in the browser that every attribute and slider behaves as before
- [x] 2.2 Generate `types/a4-sheet.d.ts` from the table, checked in `pnpm check`. Verify that a changed range regenerates the file, and the check fails if it's stale

## 3. Analysis and lens vocabulary

- [x] 3.1 Declare the lens and preset tables with `as const satisfies`, add `assertNever`, the `SegmentStyle` union, and typed `heatLevel`. Verify that `pnpm test` passes and texture.ts has no `Record<string, …>` style maps
- [x] 3.2 Make `Finding` and `VerdictId` data, and add `describeFinding` and `VERDICT_LABEL` in `components/analysis-copy.ts`, with CSS keyed by `data-tone`. Verify with a snapshot test that the English copy for every sample page and the analysis test texts is unchanged, and in the browser that the verdict colors are unchanged

## 4. Settings and library events

- [x] 4.1 Add `lib/settings.ts` (`defineSetting`, codecs, the legacy migration) and `useSetting`, and replace every `readKey` and `writeKey`. Verify with codec tests and a reload in the browser that restores the preset, lens, mode, panels, sections, and open refs
- [x] 4.2 Add `proto/a4/v1/library_event.proto`, post `LibraryEvent` bytes, and accept the old string. Verify with a codec test, and two tabs in the browser refreshing each other's library

## 5. Model contract

- [x] 5.1 Add the `ErrorCode` enum and `isModelError`, with `canceled` and a mapping for the old spelling. Verify that the transport and host tests pass, and FitToPage has no `(error as {code})` cast
- [x] 5.2 Make `RpcFrame` a oneof, reply with an error to undecodable frames with an id, and add the branded `PluginId`. Verify with transport tests (an undecodable request gets an error reply) and `pnpm proto:check`

## 6. Integration

- [x] 6.1 Run `pnpm check`, `pnpm lint`, the cast report, and `openspec validate refactor-typed-contracts --strict`. In the browser, check the lenses, the verdict, Compare, the folder, and Fit to page consent

## Workflow follow-up

- Commit and push to deploy, then archive this change.
