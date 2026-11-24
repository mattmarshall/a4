# Design

## Context

- **Prerequisites:**
  - fix-review-bugs: frozen cards, worker failure handling, result
    validation.
  - refactor-typed-contracts: the `ErrorCode` enum, the `RpcFrame` oneof,
    and `PluginId`.
  - refactor-lib-layout: the folder layout.
- **Today:**
  - `registry.ts` and `cards.ts` list the plugins twice.
  - `useModels` keeps a `MODEL_DOWNLOADED` map.
  - `ModelsPanel` and the Workbench branch on plugin ids.
  - `consent.ts` exports `grantConsent` to everyone.
  - `fit/key.ts` holds the key in a module `let`.

## Goals / Non-Goals

**Goals:**
- Adding a plugin means one descriptor, one implementation, and one
  manifest line.
- No UI file imports a plugin implementation or a plugin-specific constant.
- Consent and credentials can be reached only through the host.

**Non-Goals:**
- New operations or plugins.
- Network transports.

## Decisions

### 1. Manifest entries are lazy

```ts
export const MANIFEST = [
  definePlugin({ descriptor: semanticDescriptor, connect: () => import("./plugins/semantic/connect"), isDownloaded: () => import("./plugins/semantic/cache").then(m => m.isCached()) }),
  definePlugin({ descriptor: fitDescriptor, connect: () => import("./plugins/fit/connect") }),
] as const;
```

The descriptors are light: a card plus `as const` name tables. A build check
(from add-code-guardrails) keeps the SDK and ONNX out of the first-load
chunks.

### 2. Capabilities in the card

```proto
message ScoreCapability { repeated PlaneInfo planes = 1; repeated ScoreInfo scores = 2; repeated FindingKindInfo findings = 3; }
message PlaneInfo { string name = 1; string label = 2; float min = 3; float max = 4; repeated LegendStop legend = 5; }
message TransformCapability { repeated string instructions = 1; uint32 max_attempts = 2; }
message CredentialRequirement { string kind = 1; string label = 2; }
```

The UI renders the planes' legend from `PlaneInfo`. That replaces the
hard-coded "0.60 → 1.00" and "0.85".

### 3. `ConsentBroker`

- **Creation:** `host.consent` exposes `request(pluginId, operation, text)`,
  which returns a pending request the dialog can `approve()` once. The
  approval is a token the host consumes before connecting to the plugin.
- **No other way in:** there is no exported `grantConsent`.
- **Tests:** these keep their existing guarantees:
  - a refused call never contacts the plugin;
  - one token covers the repair attempts of one transform;
  - a token is bound to the exact text.

### 4. `CredentialStore`

`host.credentials.set(pluginId, kind, value)` and `forget(...)` keep values
only in memory. The manifest's `connect` for Fit to page receives
`getCredential()`. Error messages are checked to never include it, by an
existing-style test.

### 5. The worker factory

`createSemanticPlugin(deps)` returns the `Handlers` with closure state.
`worker.ts` is just `servePort(fromScope(self), createSemanticPlugin(realDeps))`.
Tests serve it over a `MessageChannel` with a fake extractor, covering
status, prepare, score, and not-ready.

## Risks / Trade-offs

- **[Proto changes]** → They are additive, except for the placement
  `oneof`. Its old field stays reserved, and the generated code changes
  together with its only readers in the same build. `buf breaking` reports
  the expected `oneof` move, which is allowed explicitly with a note.
- **[Consent regressions]** → The consent tests run unchanged against the
  broker, and a new test proves that a raw plugin client can't be reached
  from UI code (a dependency-cruiser rule).

## Migration Plan

No stored data is involved: models keep only Cache Storage, which is
unchanged. Reverting is a revert of the commits.

## Implementation Notes

Where the code differs from the decisions above, and why:

- **Server builds stub plugin code.** The manifest's dynamic imports pulled
  the semantic worker and the ONNX WebAssembly runtime into the server
  bundle (23 MB to 37 MB). `browserOnlyPlugins()` in `vite.config.ts`
  resolves `./plugins/<id>/connect.ts` to a stub that throws in non-client
  builds, so the server output is back to 23 MB.
- **The UI reads descriptors, not plugins.** Components import descriptors
  (ids and typed name tables) through `lib/models`. Thresholds, the
  destination host, the legend, and labels come from the cards, through
  `planeLevel` and `remoteHost(card)`. `PlaneInfo` also has `quantity` and
  `description`, so the legend's text comes from the card too.
- **Panel slots.** The models panel renders one slot per plugin, keyed by
  descriptor id (Fit to page's controls and the semantic summary), instead
  of named props.
- **Consent:**
  - FitJob's `grant` is async, because the host loads on first use. The job
    awaits only a grant that returns a Promise, so a synchronous grant keeps
    its timing.
  - Remote scoring goes through the same egress guard as transforms.
- **Credentials:**
  - The UI uses a small `KeyStore` facade over `host.credentials`.
  - A plugin receives `context.credential(kind)`, and the host refuses kinds
    its card doesn't declare.
  - The Fit adapter's `withoutKey` removes the key from error messages and
    drops a cause that contains it.
- **Attempts.** The most attempts comes from the card's
  `TransformCapability`. The host reports it at the start of each attempt,
  and FitJob's running state holds `null` until then. `MAX_ATTEMPTS` is
  gone.
- **Sheets.** `verifySheet` accepts a sheet with only text or only a grid
  and checks the view it declares. Stored records (`readSheet` and
  `writeSheet`) still need both, through a private `verifyRecord`. Plugins
  share `readTextSheet`.
- **Proto changes beyond the `oneof`.** The card's presets became
  `repeated Preset` (field 18) and `PageSpec.preset` an enum (field 8);
  `CellRect` is removed; `Sheet.text` has explicit presence; the unused
  `LOCAL_SERVICE` placement is dropped. Cards are built in code and sheets
  are never stored, so nothing old is read. `buf.yaml` allows these breaks
  for `model.proto` and `sheet.proto` only, with a note to remove the
  exception once this change has shipped.
- **`AsyncQueue`** is shared by the worker transport's reply stream and the
  semantic plugin's download progress.
