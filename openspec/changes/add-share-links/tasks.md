# Tasks

## 1. The format and the codec

- [x] 1.1 Add `proto/a4/v1/share.proto` with `SharedPages` and `SharedPage` (design decision 1). Run `pnpm proto`, and verify `pnpm proto:check` passes, with no breaking change to existing files.
- [x] 1.2 Add `lib/share/link.ts` with `shareLink(pages, origin)` and `readLink(fragmentOrUrl)`: protobuf, then raw DEFLATE, then base64url without padding, after `s1.` (design decisions 1 and 2). Add the `share` layer to `.dependency-cruiser.cjs`. Add tests, and verify they pass:
  - a round trip keeps the name, preset, paper, and bytes, including a byte-order mark;
  - a 4,800-character page of prose makes a link under 4,000 characters;
  - a link over 16,384 characters is refused before anything is copied;
  - each of these is refused with its own reason: `s2.`, bad base64, a corrupt DEFLATE stream, no pages, three pages, and text that isn't UTF-8;
  - a payload that decompresses to 2 MiB is refused, and the decoder stops reading at 1 MiB.
- [x] 1.3 Export the desk's postmark parsing from `lib/desk/letters.ts` as `readPostmark(bytes, name)`, and add `lib/share/seal.ts` with `sealOf(page)`. It returns intact, changed, or no seal, with the postmark's verdict, signer, reason, and time. Add tests, and verify they pass: an unchanged letter is intact; one changed byte is changed; a letter with a byte-order mark is checked over its exact bytes; a page with no postmark has no seal.

## 2. The commands

- [x] 2.1 Add `cli/share.ts` with `a4 share <file> [<file>]` and `a4 open <link> [--out <folder>]` (design decision 7), and add both to `a4 --help`. Allow the `cli` → `lib/share` import. Add CLI tests for each scenario in the spec, and verify they pass:
  - sharing an accepted letter prints one `https://a4.marsh.build/#s1.` link carrying its seal;
  - a link that would be too long exits 1;
  - a missing file exits 2;
  - opening writes new files and refuses an existing one (exit 2) without writing either page of a pair;
  - an unreadable link exits 1;
  - opening a sealed letter prints its seal state and writes no `.postmark.json`;
  - a name like `../../etc/x` is written as a safe file name inside the output folder.

## 3. Sharing from the app

- [x] 3.1 Add `letterForShare(slot)` to the workspace: a sealed letter's exact bytes and postmark, read from the folder (1 MiB cap), or null for any other page. Test it with the Node folder fixture, and verify: it returns the bytes for an accepted letter, null for a draft or a library page, and bytes that match the postmark's digest.
- [x] 3.2 Add Copy share link to the Page menu, and in Compare, Copy share link for A and B (design decision 5). Put the wording in `components/share-copy.ts`:
  - the notice that anyone with the link can read the page, with the link's length;
  - the too-long refusal pointing to Download;
  - the notice when the clipboard is blocked.

  Add tests for the wording, and verify in the built-in browser that the clipboard holds a link that reads back to the open page.

## 4. Opening a link in the app

- [x] 4.1 Add the shared view to the Workbench (design decision 4):
  - read the fragment on load and on `hashchange`;
  - feed read-only slots from the link, with the link's preset and paper;
  - open a pair in Compare;
  - turn Fit to page and installed pens off while it shows;
  - add a banner naming the pages, with Save a copy and Close;
  - on a refused link, give a notice and open as normal.

  Verify in the built-in browser:
  - a shared page opens read-only on its own preset and size;
  - typing changes nothing;
  - the library's page count is unchanged;
  - Close brings back the page that was open and clears the fragment;
  - an `s2.` link gives the newer-A4 notice.
- [x] 4.2 Add Save a copy: create each page with `createPage`, so names stay unique, open the copies, leave the shared view, and clear the fragment. Verify in the built-in browser that a shared "Brief" saves as "Brief 2" when "Brief" exists, and that "Brief" is unchanged.
- [x] 4.3 Show a shared letter's seal in the banner: the verdict, signer, reason, and time; intact or broken; and what a link's seal means (design decision 6). The words go in `components/share-copy.ts`, beside the desk's copy. Add tests for the intact and broken wording. Verify in the built-in browser with links from `a4 share`: an accepted letter shows its seal intact, and one with an edited byte shows it broken. Then verify that Save a copy makes a library page with no postmark.

## 5. Docs

- [x] 5.1 Add a README section, "Share links": the format, the limits, what opening and Save a copy do, sealed letters and what their seal means, and `a4 share` and `a4 open`. Also:
  - update concept.md's "Share links" item to record the decision;
  - in `docs/platform.md`, make share links roadmap step 6, built, with "Still to come", and leave the server-backed desk under Later.

  Verify that the documented commands run as written and that `pnpm lint` passes.

## 6. End-to-end checks

- [x] 6.1 Run `pnpm check`, and verify it passes, CLI tests included.
- [x] 6.2 In the built-in browser, run the whole flow, and verify each step:
  - share a page from the app, and open the link in a new tab;
  - the network log shows no request carrying the page text;
  - share a pair from Compare, and it opens in Compare;
  - open an `a4 share` link to an accepted letter, and see its seal intact;
  - Save a copy, Close, and reload, each doing what the spec says;
  - a fresh load shows no console errors.

## Workflow follow-up

- Commit, push, and check the CI and deploy runs.
- Archive the change and sync its specs.
