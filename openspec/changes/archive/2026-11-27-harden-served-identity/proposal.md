# Proposal

## Why

The last tech debt round left four items about the served library in
`docs/tech-debt-review.md`. Together they mean A4 can show a served library
it no longer knows, and can name the wrong cause:

- **A library's id is learned once per connection.**
  - A4 asks `GetLibrary` when it connects or switches, and never again while
    the library is shown.
  - So if `a4 serve` is restarted at the same address and token on a
    different folder (a copied folder still carrying its token, say), A4
    keeps the first library's id. The second folder's drafts and open pages
    are then kept under the first's.
  - The same blind spot means a server upgraded or restarted with
    `--new-token` mid-session isn't noticed. Polls fail without a word.
    Saves keep being sent and refused, or, from an older server, come back
    as answers A4 can't read.
- **A refused page origin looks like a stopped server.**
  - `a4 serve` answers only the app's own origin and the ones it's given
    with `--origin`.
  - A page served from anywhere else, such as a dev server, has its request
    blocked by the browser. A4 then says `a4 serve` isn't running, though
    it is.
- **The refusal sentences are written twice.**
  - `lib/` gives each `StoreUnavailableError` its own sentence.
  - `components/served-copy.ts` writes the same causes again, slightly
    differently, for the notice and the Connect form.
  - A save that fails shows `lib`'s wording, while a switch shows the
    copy's, so one cause reads two ways.
- **`LibraryId` is a plain `string`.** `PageName`, `Revision`, `TrashId`,
  and `PluginId` are branded, but a library's id isn't. Passing a
  connection's address where an id is meant still compiles: that's the mix
  the id was added to prevent.

## What Changes

- **The poller checks the library on every pass.**
  - While a served library is shown and the tab is visible, each poll asks
    `GetLibrary` before it lists the pages.
  - **Another library at the same connection:** A4 saves and closes the
    first library's pages, so its drafts stay with its id. It then shows the
    new library's pages, with its own open pages, and says so in a notice.
  - **Refused, as another version or for its token:** A4 shows this
    browser's library and says why, as a switch does.
  - **Stopped, or an unreadable answer:** a poll skips this pass, as now,
    since `a4 serve` may be restarting.
- **A page from another origin hears the likely cause.** When A4 can't reach
  `a4 serve` and the page isn't served from `https://a4.marsh.build`, the
  notice and the Connect form also say it may be running without
  `--origin` for this page. They name the flag with this page's origin.
- **Each refusal's cause is written once.**
  - The error's own sentence from `lib/` is the cause, everywhere.
  - `served-copy.ts` adds only what to do: from the switch, the notice, or
    the Connect form.
  - The wording of the refused-token and unreadable-answer notices changes
    slightly to fit. Their meaning doesn't change.
- **`LibraryId` is branded.**
  - Ids are minted only by `isLibraryId` and `libraryFrom`, which check
    them.
  - `servedOpenSetting`, `journalPrefix`, and `channelName` take a
    `LibraryId`.
  - `scripts/cast-report.ts` lists the brand, so a stray cast fails
    `pnpm lint:casts`.

### Out of scope

- **No protocol change.** `GetLibrary` and `ListPages` stay as they are, and
  no proto message changes.
- **No change to `a4 serve`'s origin rules.** It doesn't start answering
  origins it refuses, even to say so.
- **The small leftovers stay on the list:** the duplicated store-contract
  helpers, `PluginInstallDialog` reusing the pen panel's key classes, the
  page commands' action names inline in `useWorkspace.ts`, and Vite's dev
  client in the Semantic repetition worker.
- **A server that stops stays shown.** A library whose server stops while
  shown stays shown, with its edits kept, until it's reached again.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `served-library`:
  - **A library's identity:** A4 notices another library behind the same
    connection while it's shown, and shows it.
  - **Matching versions:** a server of another version is noticed while
    shown, not only on connecting or switching.
  - **When the server is down:** a refused token is noticed while shown,
    and a page from another origin hears that `--origin` may be missing.

## Impact

- **Workspace:**
  - `lib/workspace/library-poller.ts` asks `GetLibrary` each pass, and
    reports another library or a refusal.
  - `lib/workspace/workspace.ts` shows the new library, or this browser's,
    with a new `served-replaced` notice kind beside `served-unreachable`.
  - `lib/workspace/confirmed-store.ts` makes each change confirm the
    library first, so a save never lands in another library.
- **Store:** `lib/persist/store/wire.ts` brands `LibraryId`, and
  `remote.ts`, `serve.ts`, `settings.ts`, `library-target.ts`, and
  `cli/serve.ts` take it.
- **UI copy:**
  - `components/served-copy.ts` keeps only what to do, and gains the origin
    hint and the replaced notice.
  - `components/workspace/notices.ts` and the Connect form pass the page's
    origin.
- **Tooling:** `scripts/cast-report.ts` adds `LibraryId` to its brands.
- **Tests:**
  - `lib/workspace/served.test.ts` covers another library, an upgraded
    server, and a new token while shown.
  - `notices.test.ts` and `served-copy.test.ts` cover the new sentences.
- **Docs:** the README's "Served library", and the tech debt review.
- **No proto, storage, or bundle changes.** `pnpm check:bundle` must still
  pass.
