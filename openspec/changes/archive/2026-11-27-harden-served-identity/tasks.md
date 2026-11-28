# Tasks

## 1. A branded library id

- [x] 1.1 Brand `LibraryId` in `lib/persist/store/wire.ts`, keeping `isLibraryId` as its type guard; type `servedOpenSetting` by `LibraryId`; add `libraryIdOf(text)` in `lib/persist/store/testing/` and use it in `served.test.ts`, `remote.test.ts`, and `library-target.test.ts` (`cli/serve.test.ts` builds no ids); add `LibraryId` to `BRANDS` in `scripts/cast-report.ts`; verify `pnpm typecheck` and `pnpm lint:casts` pass, and a never-called function in `served.test.ts` with `// @ts-expect-error` on `servedOpenSetting("127.0.0.1:4320", "a")` keeps `pnpm typecheck` passing

## 2. The poller checks the library

- [x] 2.1 Give `LibraryPoller` the shown library's id and a `ServedStore`; each pass calls `library()` first: skip on `not-running`, `bad-answer`, or no reason; report `refused` on `refused`, `older-server`, or `newer-server`; report `replaced` on another id; otherwise list and report `changed` as now; verify `lib/workspace/served.test.ts` still passes, with a new case that a pass whose `GetLibrary` fails as not running lists nothing and reports nothing
- [x] 2.2 In `Workspace`, give `#switchTo` `from` and `notice` options (`from` runs the switch only while that library is shown, skipping `isShown`), wrap a served store in `ConfirmedStore` so each change confirms the library first, and handle the poller's reports: `replaced` shows the connection again and notifies `served-replaced`; `refused` shows this browser's library and notifies `served-unreachable`; add the `served-replaced` notice kind to `lib/workspace/types.ts`; verify `served.test.ts` cases with the fake scheduler:
  - another library behind the same connection: within 5,000 ms the new library's pages are shown, a `served-replaced` notice is given, and an unsaved edit to the first library's "Brief" is recovered into it when it is served and shown again, not into the second;
  - a newer server while shown: within 5,000 ms this browser's library is shown, a `served-unreachable` notice says `newer-server`, and the server receives no page operation after it;
  - a refused token while shown: within 5,000 ms this browser's library is shown, with `refused`, and the switch is still offered

## 3. The copy

- [x] 3.1 In `components/served-copy.ts`, drop `cause`: `unavailableNotice` and `connectFailed` start with the error's message for every reason and add the remedy, and both take the page's origin, adding the `--origin` hint for `not-running` when it isn't `APP_ORIGIN`; add `servedReplaced(address)`; update `notices.test.ts` to the new refused and bad-answer wording; verify `served-copy.test.ts` cases for each reason from the switch and from the form, the hint at `http://localhost:5173` and its absence at `https://a4.marsh.build`, and the replaced notice
- [x] 3.2 Pass the page's origin: `describeNotice(notice, pageOrigin)` and `connectByHand` take it, and `useWorkspace` passes `window.location.origin`; word `served-replaced` in `describeNotice`; verify `pnpm typecheck`, and a `notices.test.ts` case for `served-replaced`

## 4. Docs

- [x] 4.1 Update the README's "Served library": the poller confirms the library on each pass, another library behind the same link is shown with a notice and the first keeps its edits, a refused token or another version while shown shows this browser's library, and a page not served from `https://a4.marsh.build` is told about `--origin`; verify the section reads correctly
- [x] 4.2 In `docs/tech-debt-review.md`, move the four served-library items from the 2026-11-27 round's "Left for a later round" into "Taken up by `harden-served-identity`"; verify the list left names only the smaller copies and the dev-only worker issue

## 5. Integration

- [x] 5.1 Run `pnpm check` (lint, tests, typecheck, proto check, build, bundle check, element build) and verify it passes
- [x] 5.2 On localhost, with `a4 serve` serving a scratch folder and connected: copy the folder with its token but not its `.a4-library`, stop the server, serve the copy at the same address, and verify within 5 seconds that A4 shows the copy's pages with the "now serves another library" notice; then restart on the copy with `--new-token` and verify this browser's library is shown with the refused-token notice
- [x] 5.3 On localhost (`http://localhost:5173`), with `a4 serve` running without `--origin`, use the Connect form and verify it says the server isn't running or doesn't allow this page, and names `--origin http://localhost:5173`

## Workflow follow-up

- Commit, push, and watch CI and the deploy to a4.marsh.build.
- Archive the change, syncing the `served-library` delta.
