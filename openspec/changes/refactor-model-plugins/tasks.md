# Tasks

## 1. Manifest and descriptors

- [ ] 1.1 Add `manifest.ts` with `definePlugin`, light descriptors per plugin, and lazy `connect` and `isDownloaded`. Derive the registry, card list, and download checks from it (`download_bytes > 0`; a missing check means not downloaded). Verify that `pnpm test` passes, the bundle check passes, and adding a fake plugin in a test needs only a manifest entry

## 2. Capabilities and UI

- [ ] 2.1 Add `ScoreCapability`, `TransformCapability`, and `CredentialRequirement` to `model.proto`, make the host enforce presets and instructions, and render the models panel and the legend from the cards. Verify that `pnpm proto:check` passes (with the noted exception), host tests cover enforcement, and in the browser the Semantic legend and models list look unchanged

## 3. Consent and credentials

- [ ] 3.1 Add the host-owned `ConsentBroker` (single-use, bound to the exact text) and one egress guard, and remove `grantConsent`. Verify that the consent tests pass against the broker, and a dependency-cruiser rule forbids UI imports of plugin clients
- [ ] 3.2 Add the in-memory `CredentialStore`, inject a getter into Fit to page, and remove `fit/key.ts`'s module state. Verify with a test that errors never include the key, and in the browser that Fit to page asks for the key and forgets it on reload

## 4. Worker and cleanup

- [ ] 4.1 Add `createSemanticPlugin` with closure state and a three-line `worker.ts`, and an `AsyncQueue<T>` shared with the transport. Verify with tests over a `MessageChannel` (status, prepare, score, not-ready)
- [ ] 4.2 Make host sheets carry text or grid explicitly with `verifySheet` at the boundary; make placement a `oneof` and the preset an enum; remove the unused items and fix the test title; take `maxAttempts` from the result. Verify that `pnpm check` passes and knip reports no unused model exports

## 5. Integration

- [ ] 5.1 Run `pnpm check`, `pnpm lint`, and `openspec validate refactor-model-plugins --strict`. In the production preview, check Semantic repetition (download state, scoring, legend) and Fit to page with a stubbed adapter (consent, progress, cancel)

## Workflow follow-up

- Commit and push to deploy, then archive this change.
