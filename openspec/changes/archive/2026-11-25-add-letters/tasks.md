# Tasks

## 1. The letter format

- [x] 1.1 Add `proto/a4/v1/letter.proto` (`Postmark`, `LetterVerdict`, `Letter`, `LetterState`, `BrokenSeal`, `LetterList`, with `sealed_at` as `google.protobuf.Timestamp`) as in design decision 1. Run `pnpm proto`, commit `lib/gen/a4/v1/letter_pb.*`, and verify `pnpm proto:check` passes

## 2. Letters in the desk

- [x] 2.1 Add `lib/desk/letters.ts` with `LETTERS_DIR`, `isLetterPath`, `postmarkPath`, and `letterDigest`, exported from `lib/desk`. Add tests that:
  - the digest of "abc" is `urn:a4:letter:sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`;
  - `.agents/letters/2026-11-25-0930-auth.md` is a letter;
  - `.agents/letters/old/x.md`, `docs/letter.md`, and `.agents/letters/x.mdc` are not.

  Verify the tests pass and `pnpm lint:deps` still reports no desk violations
- [x] 2.2 Add `readLetters(fs)`. On both folder adapters, add tests for:
  - a draft (no sidecar);
  - accepted and returned letters;
  - a letter edited after sealing (Broken, `CHANGED`);
  - a sidecar that isn't a valid `Postmark` (Broken, `UNREADABLE_POSTMARK`);
  - oldest-first order;
  - rows used;
  - that files in `.agents/letters/old/` are ignored.

  Verify they pass
- [x] 2.3 Add `sealLetter(fs, path, { verdict, reason, signer, now })`. Add tests that:
  - it writes `<name>.postmark.json` as proto3 JSON with the digest, verdict, reason, signer, `sealedAt` ending in "Z", and parent;
  - the letter's bytes are unchanged;
  - it refuses an existing postmark (leaving it unchanged), a blank signer, a return without a reason, and an accept of a 63-row letter;
  - the parent is the newest intact accepted letter before this one.

  Verify they pass on both adapters
- [x] 2.4 Add `latestDelivery(letters, read)`. Add tests that it returns the newest intact accepted letter's exact text, plus the returned letters after it, and returns nothing for only drafts and broken seals. Verify they pass
- [x] 2.5 Include letters in `lintFolder` (`isContextFile(path) || isLetterPath(path)`). Add a desk test where a 63-row `.agents/letters/2026-11-25-0930-auth.md` fails 3 rows over. Verify it passes

## 3. The read-only sheet

- [x] 3.1 Add the `readonly` boolean to `ATTRIBUTES` in `lib/render/element/contract.ts` and a `readOnly` property on `A4SheetElement`. Then:
  - set the textarea's `readOnly`;
  - make `editor.ts`'s own insertions (Tab, normalized paste and drop) do nothing while it's set;
  - pass `readOnly` through `components/A4Sheet.tsx`;
  - run `pnpm gen:element-types`.

  Add a contract test for parsing the attribute, and verify `pnpm lint:element-types` and `pnpm test` pass
- [x] 3.2 Add `readonly` to the README's `<a4-sheet>` attribute table and properties list. Verify that in the `/element` demo with `readonly` set, typing and pasting don't change the text and copying still works

## 4. Letters in the workspace

- [x] 4.1 Add a `"letter"` file group to `lib/persist/folder/scan.ts`. Letters are read and measured like context files and are kept out of "other". Add a scan test that a letter lands in "letter" and not "other", and a test that pins `scan.ts`'s letter rule to the desk's `isLetterPath` on the same paths. Verify they pass
- [x] 4.2 Allow `desk` in the workspace layer (`.dependency-cruiser.cjs`, with a comment), and have `FolderIndex` attach each letter's state, postmark, and broken reason from `readLetters` after every scan. Add a workspace test that a folder with a draft and an accepted letter exposes both states. Verify it and `pnpm lint:deps` pass
- [x] 4.3 Add `Workspace.sealLetter(slot, { verdict, reason, signer })`:
  - save the slot's pending edits;
  - take the folder's Web Lock for the sidecar path;
  - call the desk's `sealLetter` with the platform clock;
  - rescan, and reopen the slot read-only.

  Make a read-only slot's `edit()` drop edits. Add workspace tests that:
  - an unsaved edit is saved before the digest is taken;
  - a second seal of the same letter (another tab, using the shared fake locks) is refused and the first postmark is unchanged;
  - typing into a sealed slot never writes the file.

  Verify they pass
- [x] 4.4 Add `Workspace.createLetter(text)` naming `.agents/letters/<UTC YYYY-MM-DD-HHMM>-letter.md`, with `-2`, `-3`, … when taken. Add tests at a fixed clock time that it creates the folders on first use, refuses nothing it shouldn't, numbers a second letter in the same minute, and opens the new letter. Verify they pass
- [x] 4.5 Add `SETTINGS.signer` with a string codec that maps blank to null. Add a settings test. Verify it passes

## 5. The Letters UI

- [x] 5.1 Render a **Letters** group above Context files in the folder section:
  - newest first;
  - each row with the name, a state badge (Draft, Accepted, Returned, Broken seal), and the rows meta with the over marker;
  - search filtering by path;
  - **New letter** in the group header, or in the folder header when the folder has no letters, creating from the Handoff template.

  Verify in the browser preview with an OPFS folder (stub `showDirectoryPicker` in the browser pane to return a directory from `navigator.storage.getDirectory()`) holding two letters
- [x] 5.2 Add `openLetter(ref)` in `Workbench.tsx`. It opens the previous letter in A and this letter in B in Compare and activates B, or opens the first letter on its own. Verify in the preview that opening the newer letter shows the older one in A
- [x] 5.3 Add `components/SealDialog.tsx`, a native `<dialog>` like the consent dialog, with:
  - the signer field prefilled from the setting;
  - Accept, disabled with "N rows over" when the letter doesn't fit;
  - Return, with a required reason;
  - Cancel;
  - the sentence on what a seal means.

  Add **Seal…** on the desk for a draft letter in the active slot (both renderings). After Accept in 3D, call the sheet's `fold()`. Show a "Sealed" chip with verdict, signer, and time for sealed letters. Verify in the preview that:
  - accepting writes the sidecar, plays the fold, and reopens the letter read-only;
  - returning requires a reason;
  - typing on the sealed letter changes nothing;
  - a 63-row letter can't be accepted.
- [x] 5.4 Check the new UI at narrow widths (1,100 px and below, where the library is a drawer) and in dark mode. Verify the Letters group, the dialog, and the chip stay usable and readable

## 6. The `a4 letters` command

- [x] 6.1 Add `a4 letters [folder] [--latest] [--json]` to `cli/a4.ts`, with usage text covering both commands. Add CLI tests that:
  - the list prints each letter's state, rows, name, signer, and reason, oldest first, and exits 0;
  - `--json` parses as an `a4.v1.LetterList` with no letter text;
  - an unknown option exits 2 with the usage.

  Verify they pass
- [x] 6.2 Implement `--latest` as in design decision 7. Add CLI tests that:
  - it prints the newest accepted letter's exact text and a note for a newer returned letter with its reason;
  - drafts and broken seals give empty stdout, a stderr note, and exit 0;
  - every file's bytes and modification time are unchanged;
  - it runs under the no-network preload.

  Verify they pass
- [x] 6.3 Add a CLI lint test where a 63-row letter in `.agents/letters/` fails 3 rows over. Verify it passes

## 7. Docs

- [x] 7.1 Add a "Letters" section to the README covering:
  - where letters live and how to name them;
  - the postmark file and digest;
  - the states;
  - sealing (Accept, Return, the signer, the fold, read-only);
  - `a4 letters` and `--latest`, with a session-start hook example;
  - that `.agents/letters/` should be kept out of line-ending conversion (`.agents/letters/** -text` in `.gitattributes`).

  Also extend the Page lint section to say it checks letters. Verify each documented command runs as written on a fixture folder
- [x] 7.2 Update `docs/platform.md` roadmap step 2 to say Letters exist and what's left for the mailroom. Verify with `grep -n "add-letters" docs/platform.md`
- [x] 7.3 Add an Implementation Notes section to `design.md` recording any decision that changed during the build. Verify it matches the code

## 8. Integration

- [x] 8.1 Run `pnpm check`. Verify it passes, and that the bundle check keeps letter code that only the CLI needs out of the home page's first load
- [x] 8.2 Do an end-to-end pass:
  1. Write a draft letter into a fixture folder with a plain file write, as an agent would.
  2. Open it in the preview (OPFS stub) and accept it.
  3. Run `node cli/a4.ts letters --latest` on a copy of that folder exported from OPFS, or on the same letter sealed by `sealLetter` on disk.

  Verify the delivered text equals the letter's
- [x] 8.3 Validate with `openspec validate add-letters --strict`. Verify it passes

## Workflow follow-up

- After the change is committed and deployed, sync the delta specs (`letters` new; `folder-pages`, `page-lint`, and `a4-sheet-element` modified) and archive the change.
