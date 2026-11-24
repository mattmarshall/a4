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
