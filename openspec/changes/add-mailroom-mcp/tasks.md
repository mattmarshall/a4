# Tasks

## 1. Exclusive file creation

- [x] 1.1 Add `exclusive?: boolean` to `FolderFs.writeAtomic`, and `"exists"` to `FsErrorCode`, in `lib/persist/folder/fs.ts` (design decision 5).
  - **Node (`fs-node.ts`):** write the temporary file, then `link` it to the target, then remove the temporary file. On `EPERM` or `ENOTSUP`, fall back to a `wx` write. Map `EEXIST` to `FsError("exists")`.
  - **Browser (`fs-browser.ts`):** stat, and refuse when the file exists.
  - **Tests** on the Node adapter, verified passing:
    - an exclusive write to a new path creates it, with its parent folders;
    - an exclusive write to an existing file throws `"exists"` and leaves the file's bytes and modification time unchanged;
    - a non-exclusive write still replaces the file.
- [x] 1.2 Make `sealLetter` write the postmark with `{ create: true, exclusive: true }`, in place of its second stat check, and map `"exists"` to `PostmarkExistsError`. Verify that the existing letters tests pass, plus a new test: a postmark created between the check and the write makes `sealLetter` throw `PostmarkExistsError` and leaves that postmark unchanged.

## 2. The mailroom's records

- [x] 2.1 Add `proto/a4/v1/mailroom.proto` with `PageCheck`, `FiledLetter`, `FilingRefusal`, and `LetterDelivery`, as in design decision 3. Run `pnpm proto` and commit `lib/gen/a4/v1/mailroom_pb.*`. Verify that `pnpm proto:check` passes, including buf breaking against main.

## 3. The desk's mailroom rules

- [x] 3.1 In `lib/desk/letters.ts`:
  - give `letterPathAt(now, n, topic = "letter")` its topic;
  - add `digest` (current bytes, or null) to `ReadLetter`, computed in `readOne` for drafts too.

  Add tests, and verify they pass:
  - `letterPathAt` names `2026-11-25-0930-auth-migration.md`, `…-auth-2.md`, and the unchanged `…-letter.md`;
  - a draft's `digest` equals `letterDigest` of its bytes, including a file that starts with a byte-order mark;
  - an unreadable letter's `digest` is null.
- [x] 3.2 Add `lib/desk/mailroom.ts` with `checkPage(text)`, which returns a `PageCheck` built from `judgeFile`, `outcomeOf`, and the report. Do not re-export it from `lib/desk/index.ts`. Add `^lib/desk/mailroom\.ts$` to the `cli-through-index` exceptions in `.dependency-cruiser.cjs`. Add tests, and verify they pass:
  - 74 rows gives FAIL, 74 of 60, 14 over;
  - exactly 60 rows passes;
  - a Noisy page gives WARN;
  - `rows_used` equals `a4 lint`'s for the same text as a file;
  - the JSON of a check whose text holds "token: sk-test-123" doesn't contain it.
- [x] 3.3 Add `fileLetter(fs, text, { now, topic })` following design decision 4. Add tests on the Node adapter, and verify they pass:
  - it files `.agents/letters/2026-11-25-0930-auth-migration.md` with the exact bytes and creates the folder;
  - the digest it returns matches `shasum -a 256` of the file;
  - a 63-row text writes nothing and gives `OVER_PAGE` with `over_by` 3;
  - a Noisy text is filed;
  - "\n\n" gives `EMPTY`;
  - text over 1,048,576 bytes gives `TOO_LARGE`;
  - "../notes", "Auth Migration", "a--b", "-a", and a 41-character topic give `BAD_TOPIC` and write nothing;
  - an existing `…-auth.md` makes it file `…-auth-2.md` and leaves the first file unchanged;
  - with `…-auth.md` through `…-auth-9.md` all present, it gives `NO_FREE_NAME`;
  - a fake `FolderFs` that throws `"exists"` on the first name makes it take the next one.
- [x] 3.4 Add `findLetter(letters, digest)` following design decision 6. Add tests, and verify they pass:
  - an accepted letter is found by its digest, with its text;
  - a draft is found by its current digest, without text;
  - a returned letter is found with its reason, without text;
  - a broken letter is found by its postmark digest, without text;
  - an unknown digest finds nothing;
  - when two letters have the same bytes, the intact accepted one wins.

## 4. The protocol

- [x] 4.1 Add `cli/mailroom.ts` with `createMailroom({ fs, now, folderName })` and its `handle(line)`:
  - parsing and the JSON-RPC errors (-32700, -32600, -32601, -32602);
  - `initialize`, with version negotiation for "2025-11-25" and "2025-06-18", the capabilities, the server info (version from `package.json`), and the instructions in design decision 7;
  - `ping`, and silence for notifications.

  Add `cli/mailroom.test.ts` tests that send raw lines, and verify they pass:
  - "2025-06-18" is echoed;
  - "2024-11-05" gets "2025-11-25";
  - the instructions name `write_letter` and `lint_page` and say a person seals;
  - a non-JSON line gets -32700 and the next request is answered;
  - an array gets -32600;
  - an unknown method gets -32601;
  - a notification gets no reply.
- [x] 4.2 Add `tools/list`: `lint_page`, `write_letter`, and `read_letter`, with titles, descriptions, input schemas with `additionalProperties: false`, and the annotations in the spec. Add `tools/call` dispatch with hand-written argument checks: a wrong type, an unknown key, or a missing `text` returns an error result. Unknown tool names get -32602. Add tests, and verify they pass:
  - the exact annotations of each tool;
  - no tool's name contains "seal";
  - calling "seal_letter" gets -32602, and the next `tools/list` is answered;
  - `{ "text": 5 }` gets an error result.
- [x] 4.3 Wire `lint_page` and `write_letter` to `checkPage` and `fileLetter`. Results carry the readable text in design decision 3, plus `structuredContent` (`toJson` of `PageCheck` or `FiledLetter`). Refusals set `isError: true`. Add tests, and verify they pass:
  - checking 74 rows reads "74 of 60 rows, 14 over" and its structured content parses as `a4.v1.PageCheck`;
  - filing at a fixed `now` creates the file, and the text says it's a draft a person must seal;
  - a 63-row letter is an error result that says 3 rows over, with no file written;
  - the structured content of either tool never contains the text checked.
- [x] 4.4 Wire `read_letter` to `readLetters`, `latestDelivery`, and `findLetter`:
  - when it delivers, the exact text in the first content block, and the provenance and "Returned since" notes in the second;
  - when nothing can be delivered, a result that isn't an error;
  - with a digest, the state without text for a draft, a returned letter, or a broken one;
  - a malformed digest is an error result;
  - `structuredContent` is a `LetterDelivery`.

  Add tests, and verify they pass:
  - an accepted letter followed by a returned one ("Missing the rollback plan") delivers the accepted text exactly and notes the reason;
  - a folder with only a draft and a broken letter says there is nothing to deliver, and the result holds neither text;
  - a digest from `write_letter` reports a draft without its text;
  - the delivered letter equals what `latestDelivery` gives for the same folder.
- [x] 4.5 Add `prompts/list` and `prompts/get` for `letter`, with an optional `topic`. An unknown prompt gets -32602. Add tests, and verify they pass: the message holds the Handoff form, starting "HANDOFF ·", names `write_letter` and `lint_page`, and includes the topic "auth" when given.

- [x] 4.6 Add `string note` to `PageCheck` (6), `FiledLetter` (6), and `LetterDelivery` (5) in `proto/a4/v1/mailroom.proto`, regenerate, and verify `pnpm proto:check` passes. Fill each note in `cli/mailroom.ts` with the result's readable words, never a letter's text; a `FiledLetter`'s nested check keeps an empty note. Add tests, and verify they pass:
  - a `lint_page` note reads "74 of 60 rows, 14 over";
  - a `write_letter` note gives the path and says the letter is a draft until a person seals it;
  - a delivered letter's note names the signer and says a seal means acceptance, not truth, without the letter's text;
  - a refusal's note says how far over.

## 5. The command

- [x] 5.1 Add `a4 mailroom [folder]` to `cli/a4.ts`:
  - a `Command` variant, with `mailroom` options rejected on the other commands;
  - a usage entry;
  - a missing folder or a file gives exit status 2;
  - a `node:readline` loop that handles one line at a time, writes each response as one line to standard output, sends diagnostics to standard error, and exits 0 when input closes.

  Add spawn tests in `cli/a4.test.ts`, with the existing no-network preload, and verify they pass:
  - `initialize`, `tools/list`, a `write_letter`, and a `read_letter` over real stdio get one JSON line each;
  - closing standard input exits 0;
  - `a4 mailroom missing` exits 2;
  - after the session, the only new file in the folder is the filed letter, and every other file's bytes and modification time are unchanged;
  - no postmark was written.
- [x] 5.2 Verify by hand against a real client:
  - register the mailroom with `claude mcp add` at local scope in a scratch repository;
  - confirm the three tools appear with their read and write marks;
  - confirm the `letter` prompt appears as a slash command;
  - confirm an over-page letter is refused and the agent rewrites it;
  - confirm a filed letter shows as a Draft in A4's Letters group, seals, and is then returned by `read_letter`.

  Record the client version used in the session notes.

## 6. Documentation

- [x] 6.1 Add a README "Mailroom" section after "Letters":
  - what the three tools do and their annotations;
  - registering with `claude mcp add` (local or user scope, and why not project scope) and with a generic `mcpServers` entry;
  - starting at the repository root, or passing the folder;
  - the session hooks: the existing `SessionStart` `a4 letters --latest`, the instructions, and the `letter` prompt;
  - no tool seals, and the mailroom makes no network request.

  Add the `pnpm a4 mailroom` row to Scripts. Verify the documented `claude mcp add` command and the JSON entry match what was tested in 5.2.
- [x] 6.2 In `docs/platform.md`:
  - mark roadmap step 3 built, with a short summary like steps 1 and 2;
  - update step 2's "Left for the mailroom" note;
  - keep the text generic, with no outside system named.

  Verify with `grep -i` that `docs/platform.md` and the README don't contain the names of private outside systems.

## 7. Integration checks

- [x] 7.1 Run `pnpm check` (lint, tests, typecheck, proto check, build, bundle check, element build) and verify:
  - it passes, with no new Biome warnings beyond the standing 43;
  - `check:bundle` shows the app's first load unchanged at 14 chunks, since nothing from `lib/desk/mailroom.ts` or `mailroom_pb` is in it.
- [x] 7.2 Run `openspec validate add-mailroom-mcp --strict`, and verify it passes.

## Workflow follow-up

- Commit the change when asked, then push and archive it (syncing the new
  `mailroom` spec into `openspec/specs/`).
