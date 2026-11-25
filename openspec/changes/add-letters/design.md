# Design: add-letters

## Context

See proposal.md for why. The code this builds on:

| Piece | Where | What it gives letters |
| --- | --- | --- |
| Folder walk and groups | `lib/persist/store/folder.ts` (`walkFolder` walks `.agents`), `lib/persist/folder/scan.ts` (`FileGroup = "context" \| "other"`, `scanFolder`) | Letters are found today, but land in "other", unmeasured |
| Folder file I/O | `FolderFs` (`readBytes`, `stat`, `writeAtomic(path, bytes, { create })`), `FolderPageFiles.create` (refuses an existing path under the Web Lock `a4:file:<id>:<path>`) | Reading letters; writing a sidecar without overwriting |
| Pages from folders | `lib/persist/store/refs.ts` (`parseFilePath` allows only `.md`/`.mdc`) | A `.postmark.json` sidecar can't be a page, so it's written and read through `FolderFs` directly |
| The desk | `lib/desk/` (`judge`, `judgeFile`, `lintFolder`; imports no Node or DOM API) | Fit and verdict for a letter; the home for letter logic shared by the app and the CLI |
| Opening and Compare | `Workspace.open(slot, ref)`, `ensureSlotB`, `useWorkspaceApi().openInSlot`; `openFitResult` in `Workbench.tsx` shows how to open A and B and activate B | Previous letter in A, this one in B |
| The fold | `A4SheetElement.fold()` (returns nothing; emits `a4-posechange` at the end; toggles without animation under reduced motion); desk Fold button only in 3D | The gesture after Accept |
| Dialogs | `FitToPage.tsx`: a native `<dialog>` with `showModal()` and `<form method="dialog">` | The pattern for the seal dialog |
| Settings | `defineSetting({ key, codec, default })`, `useSetting` | Remembering the signer's name |
| Element attributes | `ATTRIBUTES` in `lib/render/element/contract.ts` (drives parsing and the generated `types/a4-sheet.d.ts`); `editor.ts` inserts text itself for Tab and normalized paste (`execCommand("insertText")` or `setRangeText`) | Where `readonly` goes, and what it must guard |

**Gaps found:**
- nothing computes SHA-256 yet;
- the editor has no read-only mode;
- the folder list refreshes only on tab visibility or after A4 creates a file.

## Goals / Non-Goals

**Goals**
- **One implementation** of letter states, digests, delivery, and sealing,
  shared by the app and the CLI.
- **Tamper-evident seals.** Any change to a sealed letter's bytes shows as a
  broken seal, and a broken letter is never delivered.
- **Nothing is ever lost.** A4 never overwrites a postmark, never changes a
  sealed letter, and never deletes a file.

**Non-Goals**
- Authentication, encryption, or signatures.
- Watching `.agents/letters/` live.
- Letters inside the library, outside a folder.

## Decisions

### 1. `proto/a4/v1/letter.proto`

```proto
import "google/protobuf/timestamp.proto";

message Postmark {
  string letter = 1;                         // file name, e.g. "2026-11-25-0930-auth.md"
  string digest = 2;                         // urn:a4:letter:sha256:<64 lowercase hex>
  LetterVerdict verdict = 3;
  string reason = 4;                         // required when RETURNED
  string signer = 5;
  google.protobuf.Timestamp sealed_at = 6;   // proto3 JSON writes RFC 3339 UTC
  string parent = 7;                         // digest of the previous accepted letter, or ""
}
enum LetterVerdict { LETTER_VERDICT_UNSPECIFIED = 0; LETTER_VERDICT_ACCEPTED = 1; LETTER_VERDICT_RETURNED = 2; }

message Letter {                             // a letter as listed; no text
  string path = 1;                           // ".agents/letters/<name>"
  LetterState state = 2;
  Postmark postmark = 3;                     // unset for a draft or an unreadable postmark
  uint32 rows_used = 4;
  BrokenSeal broken = 5;                     // why, when state is BROKEN
}
enum LetterState { LETTER_STATE_UNSPECIFIED = 0; LETTER_STATE_DRAFT = 1; LETTER_STATE_ACCEPTED = 2; LETTER_STATE_RETURNED = 3; LETTER_STATE_BROKEN = 4; }
enum BrokenSeal { BROKEN_SEAL_UNSPECIFIED = 0; BROKEN_SEAL_CHANGED = 1; BROKEN_SEAL_UNREADABLE_POSTMARK = 2; }

message LetterList { repeated Letter letters = 1; }   // oldest first
```

- **Times:** `google.protobuf.Timestamp` makes the JSON time RFC 3339 UTC by
  construction. protobuf-es ships the well-known types, and buf resolves them
  without a dependency.
- **Name prefix:** the verdict enum is `LetterVerdict` because `a4.v1.Verdict`
  (the analysis verdict) already exists.
- **Alternative: hand-written JSON.** Rejected: the project's rule is protobuf
  across file boundaries, and JSON keeps the sidecar readable in diffs.
- **Alternative: binary `.pb`.** Rejected: it's unreadable in review, and
  people review this file.

### 2. Letter logic lives in the desk: `lib/desk/letters.ts`

- **Paths:**
  - `LETTERS_DIR = ".agents/letters"`;
  - `isLetterPath(path)` matches exactly one segment below it, ending in
    `.md`;
  - `postmarkPath(letter)` is `letter + ".postmark.json"`.
- **`letterDigest(bytes): Promise<string>`** uses `crypto.subtle.digest(
  "SHA-256", bytes)`. Web Crypto is a global in browsers and in Node 24 or
  later, so the desk still imports no Node built-ins, and the
  `desk-no-runtime` rule holds.
- **`readLetters(fs): Promise<Letter[]>`** lists `.agents/letters/` through
  `fs.entries` alone, not a full walk. For each letter, oldest first, it reads
  the bytes (subject to `MAX_FILE_BYTES`), reads and parses the sidecar,
  compares digests, and measures rows with `judgeFile`. The state follows the
  spec.
- **`latestDelivery(letters, read)`** returns the newest accepted letter with
  its seal intact, its text, and the returned letters after it.
- **`sealLetter(fs, path, { verdict, reason, signer, now })`**, in order:
  1. Refuse with `PostmarkExistsError` if the sidecar exists.
  2. Refuse a blank signer, or a return without a reason.
  3. Refuse an accept when `judgeFile` says the letter doesn't fit.
  4. Read the letter's bytes, compute the digest, and take the parent from
     `readLetters`.
  5. Write the sidecar with `writeAtomic(…, { create: true })`, after a final
     `stat` check.

  It returns the `Postmark`.
- **Why the desk:** the CLI's list and delivery and the app's seal must agree
  exactly on states and digests. The desk is already the runtime-agnostic home
  for page judgment.

### 3. Sealing in the app

`Workspace.sealLetter(slot, { verdict, reason, signer })`, step by step:
1. Save the slot's pending edits through its session. The bytes sealed are
   the bytes on disk.
2. Under the folder's Web Lock for the sidecar path (`a4:file:<id>:<postmark
   path>`, the same lock family `FolderPageFiles` uses), call the desk's
   `sealLetter` with the folder's `FolderFs` and the platform clock.
3. Rescan the folder.
4. Reopen the slot, now read-only.

Because of the lock, two A4 tabs can't both seal the same letter. The desk's
`stat` check catches anything else (the spec's "Sealed in another tab"). The
workspace layer gains `desk` in its allowed imports.

- **The fold:** after a successful Accept, the UI calls the active sheet's
  `fold()` when the rendering is 3D. The postmark is written first, so a fold
  that can't play, or is interrupted, never affects the seal.
- **The dialog:** a native `<dialog>` (`components/SealDialog.tsx`), following
  the consent dialog. It has:
  - the signer field, prefilled from the `signer` setting;
  - Accept, disabled with "N rows over" when the letter doesn't fit;
  - Return, with a required reason;
  - Cancel;
  - the sentence on what a seal means.

  A successful seal stores the signer field back into the setting.
- **The button:** on a draft letter in the active slot, the desk shows
  **Seal…** in both renderings, next to Fold in 3D.

### 4. Read-only

- **The element:** `readonly` is a boolean attribute in `ATTRIBUTES`, so it
  also reaches the generated types, and a `readOnly` property. The editor sets
  the textarea's `readOnly`, and its own insertion paths (Tab, normalized
  paste and drop) return early when it's set. Native undo has nothing to undo
  on a read-only textarea.
- **The workspace:** a slot opened on a sealed letter is marked read-only. Its
  controller's `edit()` drops edits, so nothing can reach the file even if the
  element were bypassed.
- **The React wrapper:** it passes `readOnly`.
- **The desk:** it shows a chip such as "Sealed · Accepted by Matt, Nov 25,
  09:41" in place of Seal….

### 5. The folder list

- `FileGroup` gains `"letter"`, classified by `isLetterPath`. It's
  re-implemented in `scan.ts` from the shared `LETTERS_DIR` constant, because
  the persist layer can't import the desk. A test pins the two together.
- Letters are read and measured like context files.
- `FolderIndex` (workspace) calls the desk's `readLetters` after each scan,
  for state and postmark.
- The `LibraryPanel` folder section renders a **Letters** group above Context
  files, newest first. Each row has the name, a state badge (Draft, Accepted,
  Returned, Broken seal), and the rows meta. A **New letter** button sits in
  the group header, or in the folder header when there are no letters.
- Search filters letters by path.
- Opening a letter calls a `openLetter(ref)` helper in `Workbench.tsx`. It
  finds the previous letter by name, and if there is one, sets Compare, opens
  it in A, opens this letter in B, and activates B, as `openFitResult` does.

### 6. New letter

The UI passes the Handoff template's text, so the workspace still doesn't
import content. `Workspace.createLetter(text)` names the letter
`<UTC YYYY-MM-DD-HHMM>-letter.md`, adding `-2`, `-3`, and so on before `.md`
when the name is taken (no spaces, so the names stay easy to type in a
terminal). It creates the file through the existing
`createFile` path, which creates parent folders, refuses existing paths, and
opens the letter.

### 7. `a4 letters`

- `cli/a4.ts` gains a `letters` command: `a4 letters [folder] [--latest]
  [--json]`. It uses `readLetters` and `latestDelivery` on the Node adapter.
- **Text list:** one line per letter, oldest first, such as `accepted  20/60
  2026-11-24-1700-auth.md  Matt` or `returned  31/60
  2026-11-25-0930-auth.md  Matt: Missing the rollback plan`.
- **`--latest`:** writes the letter's exact text, then for each returned
  letter after it:

  ```

  ---
  Returned: 2026-11-25-1400-auth.md: Missing the rollback plan
  ```
- **Nothing to deliver:** stdout is empty, a note goes to stderr, and the
  status is 0, so a session-start hook never fails the session.
- **`--json`:** prints the `LetterList`.
- **Usage:** the usage text covers both commands, and the usage-error rules
  are the same as lint's.
- **Lint:** `lintFolder` includes `isLetterPath` files.

### 8. Settings

`SETTINGS.signer`: key `signer`, with a string codec that maps blank to
null.

## Risks / Trade-offs

- **The seal is a name and a hash, not a signature.** Anyone with write
  access can forge a postmark. → The spec says the seal identifies but doesn't
  authenticate, and git history is the audit trail. Signatures can come later
  without changing the file name.
- **An outside writer could create the sidecar between our `stat` and our
  write.** → Web Locks cover A4's own tabs, and `writeAtomic(create)` on the
  Node adapter renames over the target. The window is milliseconds, the case
  is a human racing an agent on the same letter, and the result is still a
  valid postmark, never a lost letter.
- **The digest covers exact bytes,** so a line-ending change by git
  (`core.autocrlf`) breaks a seal. → That's intended: what was sealed is
  exactly what's delivered. The README says to keep `.agents/letters/` out of
  line-ending conversion (`* -text` in `.gitattributes`).
- **New letters written by agents appear only when the tab regains
  visibility.** → It's documented, and New letter and Seal rescan
  immediately.
- **The letters list reads every letter's bytes.** → Letters are small (one
  page), and the directory is listed rather than walked.

## Migration Plan

None. Existing folders gain a Letters group only when `.agents/letters/`
exists.

## Open Questions

- **Should returned letters be hidden** from the Letters group after a newer
  accepted letter? For now everything is listed, which is fine at the expected
  scale.

## Implementation Notes

Decisions that changed or were settled during the build:

- **Letters order by name without `.md`** (`compareLetterNames`). With the
  extension, `…-0930-letter-2.md` sorted before `…-0930-letter.md`, because
  `-` comes before `.`, which made a minute's second letter the older one.
  - New letter numbers within a minute with `-2` to `-9`, one digit so the
    numbers sort in order.
  - The `letters` spec says "without the `.md` extension" and gains a
    same-minute scenario.
- **One rule for what a letter is.** `LETTERS_DIR` and `isLetterPath` live in
  `lib/persist/folder/scan.ts`, beside `isContextFile`, and the desk
  re-exports them. That replaced the planned copy plus a pinning test; a test
  checks that both names refer to the same function.
- **SHA-256 goes through a new platform port,** `sha256` in
  `lib/platform/digest.ts`. Biome forbids the `crypto` global outside
  `lib/platform`, so the desk layer may now import `platform`. Both browsers
  and Node provide `globalThis.crypto.subtle`.
- **`BrokenSeal` gained `UNREADABLE_LETTER`,** for a sealed letter that's
  over 1 MiB or not UTF-8, so the digest can't be checked against readable
  text.
- **`latestDelivery(letters)` takes the read letters alone,** since each
  carries its own text. There's no separate `read` callback.
- **New letter removes the Handoff form's final newline** before creating the
  file. Creating a file adds the final newline itself, so the file ends with
  exactly one.
- **Read-only lives on the slot's open file** (`OpenPage.readOnly`), so it
  survives swapping A and B. `SlotSnapshot.readOnly` tells the sheet.
  `SlotController.edit` drops edits to a read-only file.
- **After a seal,** `Workspace.sealLetter` rescans and reopens the slot only
  when the seal was written, or was refused because the letter was already
  sealed. Other refusals, such as a blank name, leave the slot alone.
- **Two command line rules:** `a4 letters` rejects lint's `--strict` and
  `--exclude` and takes one folder, and `--latest` with `--json` is a usage
  error, since one prints a letter's text and the other lists letters.
- **Workspace tests share locks across tabs:** `fakePlatform` gained a `locks`
  option, and the cross-tab seal test uses a shared `FakeLocks`.
- **Fixes from the browser check:**
  - the dialog's text color is `--text`, the UI's text color, not `--ink`,
    the page's;
  - the sealed chip has a near-opaque, blurred base under its tint, like the
    desk buttons, because in Compare it sits over the sheets' captions;
  - the desk tools row wraps.
- **How the UI was verified:** in the dev server, `window.showDirectoryPicker`
  was replaced in the browser pane with a function that returns a directory
  in the browser's private storage (OPFS) holding letters. That exercised:
  - the Letters group;
  - Compare against the previous letter;
  - New letter;
  - Accept (sidecar written, fold played, read-only after);
  - Return with a required reason;
  - the blocked Accept for a 63-row letter;
  - typing on a sealed letter, which changed nothing;
  - light and dark mode at 1,000 px.
- **Lint stays out of the app's first load.** `lib/desk/index.ts` no longer
  re-exports the lint code. The a4 command imports `lib/desk/lint.ts`
  directly, and the `cli-through-index` rule allows that one file.
  - Before this, the UI's imports of the desk index pulled `lint.ts` and
    `lint_pb.js` into the home page: generated proto modules have top-level
    calls the bundler can't drop.
  - The first load is now 14 chunks and 761 KiB, up from 13 and 710. What was
    added is the letter code the app needs (states, sealing), plus protobuf's
    JSON and Timestamp support for reading and writing postmarks.
  - Loading letters only when a folder opens could recover most of that,
    later.
