# Design: harden-pens-and-plugins

## Context

See proposal.md for why, and the spec deltas for behavior. The code this
builds on:

| Piece | Where | What changes |
| --- | --- | --- |
| Fit to page's panel | `components/FitToPage.tsx` (209 lines): key form, Run, cost line, progress, its own `<dialog>`, and `PenJobChip` | Replaced by `PenPanel` |
| An installed pen's panel | `components/PenControls.tsx` (182 lines): a form per credential, instruction select, Run, progress, and a `ConsentDialog` | Replaced by `PenPanel` |
| The shared dialog | `components/ConsentDialog.tsx`: installed pens and remote overlays, with its copy inline | Every remote call, with its copy from `plugin-copy.ts` |
| The pens | `components/workbench/usePens.ts`: `fit` and `fitKey` built apart from `job(card)` and `credentials(card)`, maps keyed by `string` | One list of pens |
| Plugin ids | `lib/models/plugin-id.ts`: `PluginId`, minted only from a card. The registry's `#installed: Map<string, …>`, `remove(id: string)`, and `checkForUpdate(id: string)`, and the UI's `Record<string, …>` and `onScore(id: string)` | `PluginId` from the registry to the panel |
| The registry | `lib/models/registry.ts`: `load()` reads the store once per tab, and `install` and `remove` change only this tab | Posts and hears `PluginEvent`s |
| An installed plugin's client | `lib/models/installed-client.ts`: `stop()` closes `running` only. `status`, `prepare`, and `start` each read and hash every file | Closes for good. Remembers checked files |
| Cross-tab messages | `lib/platform/channel.ts` (`browserChannel`), `lib/persist/library-events.ts` (`a4.v1.LibraryEvent` on `a4-pages`), and `ChannelHub` in `lib/platform/testing/fakes.ts` | The same pattern for plugins |

## Goals / Non-Goals

**Goals**
- **One component per job:** one pen panel, one consent dialog, and one way
  to build a pen's job.
- **A string can't be passed where a plugin is meant,** from the registry
  to the Models panel. A test proves it at compile time.
- **Every tab agrees on what's installed** within 2 seconds, without loading
  the registry in tabs that have no plugins.
- **A removed plugin leaves nothing running,** however its start overlaps
  the removal.

**Non-Goals**
- **Changing the card or package format.** No new proto fields on
  `ModelCard`, and `PluginEvent` is the only new message.
- **Syncing credentials or consent across tabs.** They stay per tab, in
  memory, as today.
- **UI tests.** The pieces that decide are pure functions, tested under
  `node --test`. The components only render them.

## Decisions

### 1. One `PenPanel`, its words keyed on the card

`components/PenPanel.tsx` renders any pen from a `Pen` (decision 3) and the
active page:
- a credential form, or a "set" line, for each credential its card declares;
- an instruction select when its card lists more than one instruction;
- Run, a cost line when there is one, progress with Cancel, and the error.

What it says comes from `penPanel(card)` in `components/plugin-copy.ts`:
the run label, the progress line, each credential's prompt and "set" line,
the cost line (or null), and a key's placeholder (or null). Fit to page's
own wording sits there, keyed on `FIT_TO_PAGE.id`, beside `penSuffix` and
`penProgress`:
- "Fit “Brief” to the page";
- "Claude is rewriting “Brief”";
- the cost line;
- the `sk-ant-…` placeholder.

Every pen's credential buttons read **Use key** and **Forget key**.
`PenJobChip` moves here from `FitToPage.tsx`. The `fit*` CSS classes become
`pen*`.

- **Run or ask.** The panel asks for consent when the card is remote
  (`remoteHost(card) !== null`), and otherwise runs at once. That's
  installed pens' rule today. Fit to page is remote, so nothing changes for
  it.
- **Alternative:** add a placeholder and a destination display name to
  `CredentialRequirement` and `RemotePlacement`. Rejected: it changes the
  signed card format for one bundled plugin's hint text.

### 2. One consent dialog, mounted once

`consentDialog(request)` in `plugin-copy.ts` returns the dialog's title,
rows, and closing note. It's the same shape as `installDialog`:
- **The title** is "Send this page to Anthropic?" for Fit to page, and
  "Send this page to ‹host›?" otherwise.
- **The rows:**
  - Destination: the host, with "(Anthropic)" for Fit to page, "directly
    from this browser";
  - Plugin: "Fit to page, built into A4", or "‹name› ‹version› · ‹publisher
    note›";
  - Model, when the card names one. For Fit to page, it adds the
    fallback-model note.
  - Page: its name and its character count.
- **The note:**
  - "A4's server never sees the page", plus "or your ‹credential labels›"
    when the card declares credentials;
  - then what happens next, for a rewrite or a score.

`ConsentDialog` renders that and nothing else.

The Workbench mounts the one dialog. Its request comes from
`pendingConsent(lens, pens)`, a pure function in
`components/workbench/consent.ts`: the lens's pending score, else the first
pen whose job is in `confirm`. The dialog is modal, so only one call can be
waiting. Send calls that request's own `send`, and Cancel its own `dismiss`.

- **Why mount it once:** today each pen panel renders its own dialog, so a
  pending confirmation lives inside the inspector. Mounted beside the lens's
  dialog, there's exactly one, wherever the panel is.

### 3. `usePens` returns a list of pens

```ts
interface Pen {
  readonly id: PluginId;
  readonly card: ModelCard;            // the latest card, for an updated pen
  readonly publisher: string | null;   // the publisher note; null when bundled
  readonly job: PenJob<PageRef>;
  readonly credentials: CredentialStoreView;
  readonly instruction: string;
  setInstruction(instruction: string): void;
}
function usePens(...): readonly Pen[];  // Fit to page first
```

- **One builder.** Every pen's job is built by one function, as installed
  pens' are now:
  - consent and the transform go through the host for the pen's own id;
  - the instruction is the author's choice, else the card's first. Fit to
    page's card lists only `fit`, so it runs with the instruction it uses
    today.
  - a rejected key forgets every credential the card declares;
  - the jobs of pens that are gone are cancelled.
- **The order.** A pure `penCards(installed)` returns `FIT_TO_PAGE.card`,
  then each installed card that declares Transform, by name. The hook and its
  test share it.
- **The callers.** The Workbench maps the list into the Models panel's
  slots. The top bar and focus bar map it into chips. `fit` and `fitKey` go
  away.

### 4. `PluginId` from the registry to the panel

- **`InstalledPlugin.id` is a `PluginId`,** minted from its verified card.
  `loadOne` keeps `loadInstalled`'s check that the record's key matches the
  card's id.
- **`DamagedPlugin.id` stays a string.** A damaged record has no verified
  card to mint an id from. `PluginRegistryApi.remove(id: PluginId)` handles
  installed plugins, and `removeDamaged(id: string)` handles damaged ones.
  Both delete through `installed.ts`'s `remove`.
- **`checkForUpdate` takes a `PluginId`.**
- **`useModels` keys `status`, `progress`, and `errors` by `PluginId`,** as
  `ReadonlyMap`s. A `Map` keeps the key's type, where a `Record`'s computed
  keys widen to `string`.
- **The UI takes `PluginId`:**
  - the Models panel's `activeLens: PluginId | null`, `onScore(id: PluginId)`,
    and `slots: ReadonlyMap<PluginId, ReactNode>`;
  - the Workbench's `showPlugin`.
- **The proof.** `registry.test.ts` holds a function it never calls, with
  `// @ts-expect-error` on `registry.remove("example.word-length")`. So
  `pnpm typecheck` fails if a plain string is ever accepted.

### 5. Plugin events on their own channel

```proto
// proto/a4/v1/plugin_event.proto
message PluginEvent {
  oneof event {
    // A plugin was installed, updated, or removed. Other tabs read its record again.
    PluginChanged plugin_changed = 1;
  }
}
message PluginChanged { string id = 1; }
```

- **The channel.** It's named `a4-plugins`. The name is exported from
  `lib/platform/plugin-store.ts`, beside the store whose changes it
  announces. That module is already in the first load.
- **Who posts.** `RegistryDeps` gains `channel: Channel | null`.
  `pluginRegistry()` passes `browserChannel(PLUGIN_CHANNEL)`, and tests pass
  a `ChannelHub` channel. `install`, `remove`, and `removeDamaged` post
  after the store write finishes, so a tab that hears the event reads the
  new record.
- **Who hears.** On an event, the registry reconciles that one id. A queue
  serializes reconciles, so two events for one id apply in order.
  `loadOne(store, id)` gives one of three answers:
  - **Absent:** unregister it, and drop it from installed and damaged.
  - **Damaged:** unregister it, and list it as damaged.
  - **Installed:**
    - if it's registered with the same package bytes, nothing changes;
    - otherwise unregister and register it, which is what this tab's own
      update does.
- **Telling the UI.** `subscribe(listener)` is called after this tab's own
  changes and after each reconcile. `useModels` refreshes from it, so the
  explicit refreshes after `install` and `remove` go away.
- **A tab that hasn't loaded the registry,** because the browser had no
  plugins:
  - `useModels` opens a small wake channel on `a4-plugins`;
  - the first message loads the registry, whose `load()` reads the store as
    it is now, then refreshes and closes the wake channel;
  - from then on, the registry's own subscription hears events.

  The registry module stays out of the first load, and `pnpm check:bundle`
  must still pass.
- **Garbled or unknown messages are ignored.** A message that doesn't
  decode as a `PluginEvent` does nothing.
- **What another tab does with a removed plugin.** Unregistering closes its
  client and forgets its credentials and consent. Because the refreshed
  list no longer has it:
  - `usePens` cancels its job;
  - the lens's sources no longer include it, so its lens turns off.

  That's the path a local Remove takes.
- **Alternatives:**
  - **Posting a bare id string.** Rejected: messages that cross a boundary
    are protos here, and library events already moved off bare strings.
  - **Reloading every record on any event.** It's simpler, but it re-checks
    every signature. The id keeps a change to one plugin cheap.

### 6. Closing an installed plugin's client for good

`installed-client.ts` splits `stop()` in two:
- **`restart`** is internal: a declared credential changed, so the running
  sandbox stops and the next call starts a new one.
- **`close`** is the closer registered with `setCloser`. It sets `closed`
  and closes the running port.

`ensure` refuses a closed client. After `await starting`, it checks `closed`
again. If the client closed meanwhile, it closes the newly opened port and
throws `ModelError(NOT_FOUND, "‹name› was removed.")`. A Remove during a
start therefore leaves no frame, and the call fails as the spec says.

- **Alternative:** pass an `AbortSignal` into `openSandbox` and cancel the
  frame mid-load. Rejected: the sandbox's start handshake has no cancel
  point, and closing the port once it opens is enough. The frame lives at
  most until its handshake ends.

### 7. Hash a model file when it's downloaded and when it starts

- **The store.** `PluginFiles` and `PluginStore` gain
  `hasFile(digest): Promise<boolean>`:
  - `IdbPluginStore` answers with `count(digest)`, which reads no bytes;
  - `MemoryPluginStore` answers with `has`.
- **The client's memory.** The client keeps `checked: Set<string>`, the
  digests this tab has verified. A digest is added:
  - after `prepare` stores a file it verified;
  - after any full check passes.
- **`status` and `prepare`'s skip check.** For a checked digest, they ask
  only `hasFile`. Any other digest gets the full read and hash, once.
- **`start`** always reads and checks every file, because it hands those
  bytes to the sandbox. A mismatch takes the digest out of `checked`, so the
  next status says "not downloaded" and offers the download again.
- **The lifetime.** A client lives until its plugin is unregistered, so
  `checked` is per tab and per installed version.
- **Alternative:** a "verified" flag stored in IndexedDB. Rejected: anything
  that can change a stored file can change the flag. This tab's memory is
  the only record of what this tab checked.

### 8. The Models panel's copy moves to `plugin-copy.ts`

`modelsPanel` holds:
- the download note and progress;
- "Show on the page" and "Rescore page";
- "Couldn't start this model.";
- Remove's confirmation, and its success and failure notices;
- the damaged line;
- the installed and updated notices;
- the buttons ("Download (‹size›)", "Check for update", "Remove",
  "Install plugin…").

The panel renders them. `plugin-copy.test.ts` covers each.

## Risks / Trade-offs

- **[Risk] A tab still on the old build won't post or hear plugin events
  during a deploy.** → That tab behaves as it does today until it reloads.
  No message it ignores is harmful, and the new build ignores nothing it
  needs from the old one.
- **[Risk] Two tabs install the same plugin at once.** → Each writes the
  record, and the last write wins in IndexedDB. Each tab then reconciles
  from the store, so all of them end with the stored version.
- **[Trade-off] Status trusts a checked file without rereading it.** A file
  changed on disk after this tab checked it shows as ready, until the plugin
  starts. → `start` checks every file, refuses to start on a mismatch, and
  asks for the download again. That's the spec's "A file that changed while
  stored" scenario.
- **[Trade-off] An update in another tab forgets this tab's credentials for
  that pen.** → It matches what an update does in this tab. Keeping keys
  across versions is out of scope.
- **[Risk] Fit to page's dialog changes.** It gains a Plugin row and the
  shared title shape. → The fit-to-page spec's confirmation still names
  Anthropic, `api.anthropic.com`, the model, the page, and the characters.
  The consent copy test asserts each.

## Migration Plan

- **No stored data changes shape.** Plugin records and files are as before,
  and `hasFile` only reads.
- **Deploy is a normal Worker deploy.** Old and new tabs coexist, as the
  first risk describes.
- **Rollback is a revert.** The new proto message and channel go unused.
