# Proposal

## Why

The next two items in `docs/tech-debt-review.md`'s "Left for a later round"
are the pen UI and the plugin lifecycle. They live in the same hooks and
panel.

**The pen UI is written three times.**
- `components/FitToPage.tsx` and `components/PenControls.tsx` are near
  copies. Each has its own key form, Run button, progress line, Cancel, and
  error line.
- Fit to page has its own consent dialog, inline in `FitToPage.tsx`.
  Installed pens and remote overlays share `components/ConsentDialog.tsx`.
  So Fit to page's dialog names no plugin, and the other dialog doesn't say
  the key stays out of A4's server.
- `usePens` builds Fit to page's job and key separately (`fit`, `fitKey`)
  from the installed pens' jobs, though they're wired the same way.
- `PluginId` stops at the registry. The Models panel, `useModels`, `usePens`,
  and the registry pass plain strings (`onScore(id: string)`,
  `remove(id: string)`, `Record<string, …>`). So a plane key, a page name,
  or a typo compiles where a plugin is meant.
- The Models panel writes its copy inline: download notes, Remove's
  confirmation, a damaged plugin's line, and the notices.

**The plugin lifecycle has three gaps.**
- **Another tab's install or remove isn't heard.** A tab keeps listing a
  plugin another tab removed. It keeps running that plugin's lens and pen
  from the copy it loaded, until a reload. A plugin installed elsewhere
  doesn't appear.
- **A Remove during a sandbox start can leave its frame.** Removing a plugin
  closes its running sandbox. But a start still in flight finishes after
  that, and its sandboxed frame stays open with nothing to close it.
- **Model files are hashed on every status check.** An installed plugin's
  status reads every model file from IndexedDB and hashes it each time the
  Models section refreshes. Every install or remove refreshes it, and with
  cross-tab updates it will refresh more often. A 38 MB model costs a full
  read and SHA-256 each time.

## What Changes

- **One pen panel.**
  - `components/PenPanel.tsx` replaces `FitToPage.tsx` and
    `PenControls.tsx`. Fit to page is a pen like any other: its card
    declares one instruction and one credential.
  - Its key form, Run button, progress, Cancel, and error line are written
    once.
  - What a pen's panel says comes from `components/plugin-copy.ts`, keyed on
    the card, as `penSuffix` and `penProgress` already are. That includes
    Fit to page's own wording: its run label, its cost line, "Claude is
    rewriting", and its key placeholder.
  - Every credential form's buttons read **Use key** and **Forget key**.
- **One consent dialog.**
  - `ConsentDialog` confirms every call that sends page text away: Fit to
    page, an installed pen, and a remote overlay's score.
  - Its words come from a new `consentDialog()` in `plugin-copy.ts`. It
    names:
    - the destination host, with its owner where A4 knows it ("Anthropic");
    - the plugin, its version, and its publisher, or "built into A4";
    - the model, the page, and the characters sent;
    - which credentials go with the page.
- **One way to build a pen.**
  - `usePens` returns a list of pens, Fit to page first. Each pen has its
    card, id, job, credentials, and instruction.
  - The Workbench, the Models panel, and the top bar map over that list.
    `fit` and `fitKey` go away.
- **`PluginId` through the UI.**
  - The registry's installed plugins carry a `PluginId`.
  - The Models panel, `useModels`, `usePens`, and the Workbench key their
    maps and take their arguments by `PluginId`.
  - A damaged plugin has no verified card, so its stored id stays a string.
    It's removed by a separate `removeDamaged`.
- **The Models panel's copy moves to `plugin-copy.ts`:**
  - download and progress notes;
  - Remove's confirmation and its notices;
  - the damaged line;
  - the install and update notices.
- **Every tab sees the same plugins.**
  - An install, update, or removal posts an `a4.v1.PluginEvent` on a new
    `a4-plugins` BroadcastChannel.
  - Other tabs read that plugin's record again and register, replace, or
    unregister it. A removed plugin's lens turns off and its running pen
    stops, as they do in the tab that removed it.
  - A tab that hasn't loaded the registry, because it had no plugins, loads
    it on the first message.
- **A Remove ends a sandbox that's still starting.** Once a plugin is
  removed, its client is closed for good. A start that finishes after that
  closes its sandbox at once, and the call fails as removed.
- **A model file is hashed when it's downloaded and when its plugin starts,
  not on every status check.**
  - The plugin store gains `hasFile`.
  - Status trusts a file this tab already checked, as long as it's still
    stored. It reads and hashes only a file it hasn't checked.
  - Starting the sandbox still reads and checks every file it hands over.

### Out of scope

- Any change to what consent, the sandbox, signatures, or pinned keys
  enforce. The host still consumes a consent token for exactly the approved
  text.
- New card fields, such as a credential placeholder or a destination's
  display name. Fit to page's own wording stays in `plugin-copy.ts`.
- Merging the plugin and handle stores' IndexedDB helpers, and the other
  smaller copies in the review.
- Inline copy elsewhere: shared views and the served library.
- The Connect form's error, and the `shared` slot variant.
- Keeping the installed pens' credentials across an update. An update still
  forgets them, here and in other tabs.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `installed-plugins`:
  - Every tab hears an install, update, or removal without a reload.
  - Removing a plugin closes a sandbox that's still starting.
  - A model file is hashed when it's downloaded and when the plugin starts,
    not each time the Models section checks it.
- `model-plugins`: the privacy gate's confirmation is one dialog for every
  plugin that sends text away, bundled or installed, pen or overlay. It
  names the plugin as well as the host, model, page, and characters.

## Impact

- **Protos:** `proto/a4/v1/plugin_event.proto` adds `PluginEvent`. The change
  is additive, so `pnpm proto:check` must still pass.
- **Models:**
  - `lib/models/registry.ts` posts, hears, and reconciles plugin events, and
    lets the UI subscribe.
  - `installed.ts` reads one record (`loadOne`), and an installed plugin's
    id becomes a `PluginId`.
  - `installed-client.ts` closes for good on removal, and remembers which
    files this tab checked.
  - `registry-api.ts` gains `subscribe` and `removeDamaged`, and takes
    `PluginId`.
- **Platform:** `lib/platform/plugin-store.ts` gains `hasFile` and the
  channel name.
- **UI:**
  - `components/PenPanel.tsx` is new.
  - `FitToPage.tsx` and `PenControls.tsx` are deleted.
  - `ConsentDialog.tsx`, `ModelsPanel.tsx`, `useModels.ts`, `usePens.ts`,
    `Topbar.tsx`, and `Workbench.tsx` are rewired.
  - `plugin-copy.ts` gains the pen, consent, and Models panel copy.
  - `ModelsPanel.module.css` renames its `fit*` classes to `pen*`.
- **Bundle:** the first load gains only the channel name and a listener.
  `pnpm check:bundle` must still pass.
- **Docs:**
  - The README's Fit to page and Third-party plugins sections describe the
    shared dialog and cross-tab updates.
  - The two items move out of the review's "Left for a later round".
