# Proposal

## Why

The model ecosystem was meant to let plugins be added and replaced on their
own. Today, adding a plugin touches four places:
- two lists that must "keep in step";
- a map of download checks;
- `card.id === X` branches in two UI files.

The UI imports plugin internals: thresholds, cell values, Fit to page's host
and model, and score names written as literals. Consent and the API key are
module-level state, open to any importer. The review
(`docs/tech-debt-review.md` M1–M5, M9, M10, M12) lists each of these.

## What Changes

- **A manifest:** `lib/models/manifest.ts` is the only place a plugin is
  registered, through `definePlugin({ descriptor, connect, isDownloaded })`.
  The fields are lazy thunks, so the manifest stays light. The registry,
  card list, and status checks derive from it.
- **Descriptors and implementations:**
  - `plugins/<id>/descriptor.ts` (light) holds the card and typed score,
    finding, and plane names, shared by the worker and the UI.
  - The implementation (`adapter.ts` or `worker.ts`) is loaded only through
    `connect`.
  - The UI never imports an implementation.
- **Capabilities on the card:**
  - `model.proto` adds `ScoreCapability` (planes with labels and scale,
    scores, and finding kinds), `TransformCapability` (instructions,
    `max_attempts`), and `CredentialRequirement`.
  - The models panel and the legend render from them, with an optional
    per-plugin UI slot.
  - The host enforces declared presets and instructions.
- **Consent owned by the host:**
  - A `ConsentBroker` created by the host. Only the consent dialog gets the
    capability to mint tokens.
  - Each token is single-use, bound to the plugin, the operation, and the
    exact text, compared by value rather than by hash.
  - One egress guard covers every operation, including Encode and Generate
    once they have host paths.
- **Credentials owned by the host:**
  - An in-memory `CredentialStore`, keyed by plugin and the credential kind
    the card declares.
  - Plugins receive a getter at construction.
  - `fit/key.ts`'s module-level `let` and the exported `currentApiKey` go
    away.
- **A testable worker:**
  - `createSemanticPlugin({ importLibrary, isCached })` keeps its state in
    a closure, and `worker.ts` shrinks to three lines.
  - Tested over a `MessageChannel` with a fake extractor.
- **Download checks:**
  - "Needs download" follows `download_bytes > 0`, not the privacy flag.
  - A missing cache check counts as "not downloaded".
  - `isDownloaded` is required by type when `download_bytes > 0`.
- **Contract cleanup:**
  - Host sheets carry text or grid explicitly, so `verifySheet` holds.
  - `placement` becomes a `oneof { Browser; Remote { destination_host } }`,
    and the preset an enum.
  - Unused code is removed or marked experimental (`cellIndex`, `CellRect`,
    `View.PIXELS`), and a wrong test title is fixed.
- **Shared code:** an `AsyncQueue<T>` replaces the duplicate queue logic in
  the worker and the transport. `maxAttempts` comes from the result, not
  from "of 3" in the UI.

## Capabilities

### New Capabilities

### Modified Capabilities

(None: behavior is unchanged, so `skip_specs` is set.)
- Consent is still asked for each call, for the exact text, and the key is
  still never persisted.
- The tightened consent internals enforce the existing `fit-to-page` and
  `model-plugins` requirements more strictly; they don't change them.

## Impact

- **Models:** `lib/models/` (manifest, host, consent, credentials, registry
  replaced, plugins reorganized, worker factory) and `lib/tensor/` (record
  verification at the boundary).
- **Contracts:** `proto/a4/v1/model.proto` and `sheet.proto` (additive,
  plus `oneof`s, checked with `buf breaking`), regenerated into `lib/gen/`.
- **UI:** `components/` (`useModels`, `ModelsPanel`, `FitToPage`, legend)
  renders from cards.
- **Scripts:** `scripts/fit-smoke.ts`.

## Out of scope

- New plugins.
- Out-of-process (HTTP) transports: the port adapter design allows them
  later.
- Moving Fit to page into a worker: that would put the key in a structured
  clone, and needs its own design.
