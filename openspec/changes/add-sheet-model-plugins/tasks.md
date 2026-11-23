# Tasks

## 1. Contract and codec

- [x] 1.1 Add `@bufbuild/protobuf`, `@bufbuild/buf`, and `@bufbuild/protoc-gen-es`, write `proto/a4/v1/sheet.proto` and `proto/a4/v1/model.proto`, and add `pnpm proto` generating `js+dts` into `lib/gen/`; verify a Node test imports the generated `Sheet` schema under type stripping
  - Verified: `lib/tensor/proto.test.ts` loads the generated JavaScript under Node's type stripping and round-trips a `Sheet` and a `ModelCard`. `buf lint` adopted the standard `…Service` and `…Response` names.
- [x] 1.2 Implement the codec in `lib/tensor/` (encode, decode, offset ↔ cell, span → cells) and move `lib/paper/pick.ts` onto its mapping; verify property tests for round trip and `layoutRows` parity, every `sheet-tensor` scenario as a unit test, and the existing paper tests all pass
  - Verified: property tests cover 2,000 generated strings at 3 shapes (newline runs, NUL, lone surrogates, astral pairs, column multiples). All 13 codec tests pass, and so do the 14 paper tests, now that `pick.ts` re-exports the shared mapping.
- [x] 1.3 Read and write sheet records as protobuf bytes, rejecting a grid that does not decode to its text with an error naming the first mismatching row; verify the "consistent record" and "corrupt record" scenarios as unit tests
  - Verified: 5 record tests. A corrupt record names row 0, or row 2 when the mismatch is further down. Lone surrogates are refused at write time, because protobuf strings are UTF-8.
- [x] 1.4 Make `pnpm check` fail when committed generated code differs from a fresh `pnpm proto`, and document the codec and the `a4.v1` record in README; verify the check fails after editing a `.proto` without regenerating, and passes after
  - Verified: `pnpm proto:check` failed after a `.proto` comment edit ("out of date: lib/gen/a4/v1/sheet_pb.d.ts") and passed after it was reverted. It also runs in CI.

## 2. Plugin host

- [x] 2.1 Implement the host and registry: model cards, operation gating, plane shape validation, host-enforced fit, and the repair loop (at most 3 attempts, passing `resume` bytes back unchanged); verify unit tests with an in-process fake plugin for the undeclared-operation, wrong-shape-plane, over-by-3-rows, fits-on-second-attempt, and never-fits scenarios
  - Verified: 11 host tests, including that a plane computed for other text is rejected, and that the fewest-rows attempt is kept even when a later one is worse.
- [x] 2.2 Implement the worker transport with `RpcFrame` protobuf frames; verify a Node test round-trips Describe and Score over a `MessageChannel`, and that `pnpm build` emits a module worker that loads in the production preview
  - Verified: 5 transport tests, including an all-default reply (zero bytes) found in the production preview and fixed. The production worker answered Describe and Status there.
- [x] 2.3 Implement the single-use consent token bound to page text revision and character count; verify unit tests that a used token, or a token for different text, is refused before any adapter runs
  - Verified: 5 consent tests. No token, a reused token, a token for other text, a token for another plugin, and a forged token are all refused before the plugin runs.
- [x] 2.4 Document the plugin contract, placements, and privacy rules in README; verify every rule in the `model-plugins` spec is described
  - Verified: README "Model plugins" covers all 10 `model-plugins` requirements.

## 3. Planes and model lenses

- [x] 3.1 Add a heat layer to the painter, used by Flat and by the 3D texture; verify in the browser that values of 0 leave cells untinted and 1 gives the strongest tint, in both renderings
  - Verified on `/element`: in Flat, a value of 1 painted (181, 146, 233), 0.5 painted (216, 199, 240), and 0 left paper (253, 252, 248). The 3D screenshot matched. A bug where only rows with text were tinted was found and fixed.
- [x] 3.2 Add `setPlane`, `removePlane`, and `lens="model:<name>"` to `<a4-sheet>`, with the staleness rule and a RangeError for wrong sizes, plus a `planes` prop on the React wrapper; verify all three `a4-sheet-element` scenarios in the browser on `/element`, and update the `/element` docs and README
  - Verified on `/element`: a plane showed in 3D and Flat, a wrong-size plane threw a RangeError with the planes unchanged, and typing switched the sheet to Ink until the text matched again.
- [x] 3.3 List model lenses beside the built-in lenses with a legend naming the plane and plugin; verify in the browser that choosing one replaces the previous lens without changing the text
  - Verified in the workbench: "Semantic" appears beside the built-in lenses once the model is ready, and choosing it replaced Ink with the text unchanged. The legend names the plane and plugin. Choosing Syntax turned the model lens off.

## 4. Semantic repetition

- [x] 4.1 Implement unit extraction from line classes (sentences in prose paragraphs, one unit per structured or heading line, skipping units under 12 non-whitespace characters); verify unit tests for "sentences across wrapped lines" and "short fields are skipped"
  - Verified: unit tests for wrapped sentences, short fields, and list items. List items start a new paragraph; the spec was updated to say so.
- [x] 4.2 Implement similarity to plane values and the summary (count, top 5 pairs, identical units excluded); verify unit tests with fixed vectors for 0.62 → 0, 0.91 → 0.7, the exclusion, and the 5-pair cap
  - Verified: unit tests for 0.62 → 0, 0.91 → 0.7, identical units excluded, and the 5-pair cap.
- [x] 4.3 Run the embedding model in the worker with a pinned model revision, an explicit download that shows its size, and caching; verify in the browser that the size is shown before downloading, that scoring works, that the network log shows no request carrying page text, and that scoring works offline after the download
  - Verified: the card said "Download (38.0 MB)" before any request, and the download showed live progress. In fresh Chrome profiles, in dev and the production build, scoring made no network request, no request carried the page's marker text, and offline scoring worked in a second session.
  - Changes: the runtime is self-hosted (no CDN), and Hub URLs are pinned to the commit. In production, unused runtime files are dropped and the library's window guard is kept.
- [x] 4.4 Calibrate the 0.85 and 0.70 thresholds on a fixture set of paraphrase and unrelated pairs, and record the results in this change; verify the "paraphrase" scenario passes, and update the spec numbers here first if calibration moves them
  - Verified: results are in `calibration.md` (30 pairs). The thresholds stay at 0.85 and 0.70, and the paraphrase scenario scores 0.918 to 0.949.
- [x] 4.5 Add the plugin list, the Semantic repetition lens, the metrics summary (selecting a pair selects the later unit), and rescoring 1,500 ms after typing stops, and document it in README; verify the "reviewing restatements" and "editing with the lens on" scenarios in the browser
  - Verified in the workbench: "4 of 8 sentences and fields restate another". Selecting a pair selected the later sentence. Deleting it showed "Rescoring…", then "2 of 7".

## 5. Fit to page

- [x] 5.1 Implement the Claude adapter: dynamic SDK import, `dangerouslyAllowBrowser`, streaming `claude-opus-5-5` at explicit `medium` effort, server-side refusal fallbacks, append-only history in `resume`, error mapping, normalization, and stripping a wrapping code fence; verify unit tests with a stubbed client for each error mapping, append-only resume, and fence stripping, and confirm `pnpm typecheck` against the SDK's beta streaming types
  - Verified: 9 adapter tests with a stubbed client and the SDK's real error classes, including that a repair sends the first reply back unchanged, thinking block included. `pnpm typecheck` passes against `@anthropic-ai/sdk` 1.12.0.
- [x] 5.2 Add the in-memory key field with Forget key, and the consent dialog naming api.anthropic.com, the model, the fallback note, the page, and the character count; verify in the browser that reload forgets the key, that localStorage and OPFS never contain it, and that declining makes no network request
  - Verified with a made-up test key and a stubbed `fetch`. The key field cleared on use, a reload forgot the key, and the key text was in none of localStorage, sessionStorage, the OPFS files, Cache Storage, or IndexedDB. Cancel in the consent dialog made no request.
- [x] 5.3 Save the result as "<name> (fit)" (made unique), open it as B in Compare, and create nothing on a rejected key, network failure, refusal, or cancel; verify the failure and cancel paths in the browser with a stub transport, then verify one real run end to end with the author entering their own key
  - Verified with a stubbed `fetch`: "Untitled (fit)" opened as B beside "Untitled" as A. A second run was named "Untitled (fit) 2". A never-fitting reply made 3 attempts and was kept with "still over by 10 rows". A rejected key, network failure, refusal, and cancel each showed their message and created no page.
  - Real runs with the author's own key (from `.env.local`, through the same host and adapter, run with `scripts/fit-smoke.ts`; the author chose to run it from Node):
    - Rewriting the 116-row JSON sample gave 42 rows with `claude-opus-5-5`, in 13.3 s, on the first attempt. A4 rated it Balanced: about 568 tokens (from about 1,015), 1% syntax, 94% narrative, and every number and ID kept.
    - With the page shrunk to 18 rows, and then to 6, it fit on the first attempt both times.
    - A forced repair turn was accepted, with the first reply (thinking block included) resent unchanged.
  - Browser path: the dev page could read Anthropic's 401 for an invalid key, so the API allows direct browser access. The consent dialog with a real key was not run; it was verified with the stub.
- [x] 5.4 Document Fit to page in README (what is sent, to whom, typical cost, how the key is held); verify the text matches the consent dialog
  - Verified: README "Fit to page" matches the consent dialog and card (destination, model, fallback note, page and character count, asked every time, key held in memory, cost).

## 6. Integration

- [x] 6.1 Run `pnpm check` and `openspec validate add-sheet-model-plugins --strict`, and compare the main bundle against the previous build; verify both pass, the SDK and inference library load only on first use, and the main bundle grows only by the codec and protobuf runtime
  - Verified: `pnpm check` (195 tests, typecheck, proto check, build) and strict validation pass. In a fresh profile, startup JavaScript grew from 633 KB to 682 KB uncompressed (+49 KB): the protobuf runtime, the generated schemas, the codec, and the Models panel. No worker, SDK, inference library, or WebAssembly loads at startup.

## Workflow follow-up

- Commit and push to deploy, then archive this change.
