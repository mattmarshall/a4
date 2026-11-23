# Design

## Context

- **The row model is already exact.** `layoutRows` in `lib/text.ts` breaks a
  row after `cols` UTF-16 code units or at a newline, and marks each row as a
  continuation or not.
- **The renderers already map positions.** Both renderings map cells to text
  offsets (`cellAt` and `caretOffset` in `lib/paper/pick.ts`). The painter
  (`lib/paper/texture.ts`) already tints cells per lens, in Flat and in the 3D
  texture.
- **There is no protobuf tooling, model runtime, or network call with page
  text yet.** Tests run on Node's type stripping (`node --test
  'lib/**/*.test.ts'`). TypeScript `enum`s are not erasable syntax, so tests
  can't import generated TypeScript that uses them.
- **Constraints from the project config:**
  - Page text stays on the device unless the author sends it.
  - Boundary records are protobuf.
  - The 80 × 60 Terminal grid is the product invariant.
- See `proposal.md` for motivation, and the delta specs for required behavior.

## Goals / Non-Goals

**Goals:**
- One contract that a worker, a remote API adapter, and a future out-of-process
  service can all implement without changing the host.
- A codec that is provably lossless, so training data and model output can be
  trusted to mean exactly one page.
- The host, not any plugin, owns fit, consent, and what happens to the result.

**Non-Goals:**
- A general plugin marketplace or sandbox for untrusted code; only bundled
  plugins run.
- Making model scores part of the verdict.
- Streaming the rewrite into an editable page while it is being written; the
  page is created once the host accepts a result.

## Decisions

### 1. One cell per UTF-16 code unit

A cell holds one UTF-16 code unit, which equals the Unicode code point for
every character in the Basic Multilingual Plane.

- **Why:** this is exactly what `layoutRows`, the textarea's selection
  offsets, and `caretOffset` count. Using it makes the grid, the editor, and
  every text span agree with no translation, and it is lossless for any
  JavaScript string.
- **Code points instead?** Rejected. Astral characters would desynchronize
  grid offsets from editor offsets.
- **UTF-8 bytes?** Rejected. Accented letters would take two cells.
- **Tokenizer ids?** Rejected. They are model-specific, and a model can
  tokenize the text view itself.
- **Known limitation, unchanged:** an emoji takes two cells here, as it does
  in the editor's row model.

### 2. Row lengths and continuation flags, not sentinels

The grid stores `row_lengths` and `continuation` per row, and pads with 0.

- **Why not markers in the cells?** Reserving 0 or a newline marker would make
  NUL characters ambiguous, and newline cells would change the shape.
- **Decoding:** for each used row, insert `\n` before it unless it is the
  first row or a continuation, then append its cells up to its length. This is
  the exact inverse of `layoutRows`.
- **Testing:** property tests check, over generated strings, that decoding
  gives back the original text and that row breaks match `layoutRows`. The
  strings include newline runs, exact multiples of `cols`, NUL, lone
  surrogates, and trailing spaces.

### 3. Shape `[max(preset rows, used rows), cols]`

- **Why:** pages that fit have the preset's fixed shape (`[60, 80]` on
  Terminal), so batches stack with no special cases.
- **Overflowing pages keep all their rows** instead of being cut off, so the
  record stays lossless. Training code can crop to 60 rows and use `rows_used`
  as a mask.

### 4. `a4.v1` protobuf contract with protobuf-es

- **Location:** `proto/a4/v1/sheet.proto` (the record, grid, planes, spans,
  embeddings) and `proto/a4/v1/model.proto` (cards, requests, events,
  service).
- **Generation:**
  - `@bufbuild/buf` with `@bufbuild/protoc-gen-es`, using `target=js+dts`,
    into `lib/gen/`, committed.
  - JavaScript plus `.d.ts` keeps Node's type-stripping test runner working.
    It can't run generated TypeScript `enum`s.
  - `pnpm proto` regenerates. `pnpm check` regenerates into a temporary
    directory and fails if the committed code differs.
- **Alternatives rejected:**
  - Hand-written TypeScript interfaces: these break the owner's
    proto-by-default rule for boundary records.
  - Zod or JSON Schema: not this project's schema layer.
  - safetensors: good for weight files, but it can't carry text, spec, and
    metadata in one record. It can be added later as an extra export format
    for dense planes.

Sketch (the full contract is in `proto/a4/v1/`; names follow `buf lint`'s standard rules):

```proto
syntax = "proto3";
package a4.v1;

message PageSpec { string preset = 1; uint32 cols = 2; uint32 rows = 3;
  double cell_w_mm = 4; double cell_h_mm = 5; double margin_x_mm = 6; double margin_y_mm = 7; }
message Grid { uint32 rows = 1; uint32 cols = 2; uint32 rows_used = 3;
  repeated uint32 cells = 4;          // UTF-16 code units, row-major, 0-padded
  repeated uint32 row_lengths = 5; repeated bool continuation = 6; }
message Sheet { PageSpec spec = 1; string text = 2; Grid grid = 3; }
message TextSpan { uint32 start = 1; uint32 end = 2; }
message Plane { string name = 1; string label = 2; repeated uint32 shape = 3;
  repeated float values = 4; string text = 5; }   // text it was computed for
message Embedding { Granularity granularity = 1; TextSpan span = 2; repeated float vector = 3; }
message ModelCard { string id = 1; string name = 2; string version = 3;
  repeated Operation operations = 4; repeated View views = 5; repeated string presets = 6;
  Placement placement = 7; bool sends_text_off_device = 8; string destination_host = 9;
  uint64 download_bytes = 10; }
service SheetModelService {
  rpc Describe(DescribeRequest) returns (DescribeResponse);   // wraps ModelCard
  rpc Status(StatusRequest) returns (StatusResponse);         // model files ready?
  rpc Prepare(PrepareRequest) returns (stream PrepareResponse); // download, on request
  rpc Encode(EncodeRequest) returns (EncodeResponse);
  rpc Score(ScoreRequest) returns (ScoreResponse);            // planes, scores, findings
  rpc Transform(TransformRequest) returns (stream TransformResponse);
  rpc Generate(GenerateRequest) returns (stream GenerateResponse);
}
```

In proto3, repeated numeric fields are packed. ASCII cells therefore cost one
byte each on the wire, so the grid of a full Terminal page is about 5 KB, and a
record carrying the text as well is about 10 KB.

### 5. A stateless plugin contract, with the repair loop in the host

- **The host owns the loop:** it runs a Transform, lays out each candidate
  with the codec, and asks again with feedback ("over by N rows"), up to 3
  attempts. Plugins never judge fit.
- **Plugins stay stateless:**
  - A `TransformResponse` candidate carries an opaque `resume` byte field. The
    host passes it back unchanged with the feedback.
  - The Claude adapter stores its full message history there (each response's
    content blocks, appended unchanged). The conversation is therefore
    append-only, which preserved thinking requires.
  - The bytes live only in memory for the length of the run.
- **Alternatives rejected:**
  - A stateful session per plugin: more lifecycle to manage, and it leaks
    across runs.
  - Rebuilding the conversation from text only: this edits history and drops
    thinking blocks.

### 6. Transports

- **Two transports:**
  - An in-process transport, used by the Claude adapter, which needs the main
    thread's abort controls.
  - A worker transport, used by the embedding plugin, which runs in a module
    Web Worker (`new Worker(new URL(…), { type: "module" })`).
- **Worker messages:**
  - Frames are an `RpcFrame` protobuf (id, method, payload bytes, end or
    error), sent over `postMessage` with transferable buffers.
  - The worker serves the same generated service shape, so moving a plugin to
    an HTTP service later changes only the transport.

### 7. Consent is a single-use token

The Claude adapter's Transform requires a `ConsentToken`.

- **Who makes one:** only the consent dialog's Send handler. A token is bound
  to the page revision and character count shown, and is consumed on first use.
- **Why:** this makes "confirm every call" structural rather than a UI
  convention. No code path can reach the network with page text without a
  fresh token.
- **The key** lives in a module-scoped variable in the adapter. It is never
  passed through React state, storage, the journal, or logs, and Forget key
  clears it.

### 8. Claude adapter

- **Loading:** `@anthropic-ai/sdk` is imported dynamically on first use, and
  the client is constructed with `dangerouslyAllowBrowser: true`. That is the
  SDK's documented opt-in for browsers; an author-supplied key is the case it
  exists for.
- **Request:**
  - `claude-opus-5-5`, streaming with `finalMessage()`, `max_tokens: 64000`.
  - `output_config.effort: "medium"`, set explicitly.
  - Adaptive thinking, which is always on for this model.
  - Server-side refusal fallbacks enabled (`fallbacks: "default"` with the
    `server-side-fallback-2026-07-01` beta). The consent text says Anthropic
    may route a declined request to a fallback model.
  - To verify during implementation: that the beta streaming call accepts
    these fields.
- **Output is plain text, not structured output:**
  - The result *is* the page. JSON escaping would distort it, and plain text
    lets the dialog show progress while it streams.
  - The system prompt gives the budget: at most 60 rows of 80 columns, where
    long lines wrap and each newline starts a row. It also gives the narrative
    guidance and the current overflow, and asks for only the page text.
  - The adapter strips one wrapping code fence if the model adds one, and the
    host normalizes the result with `normalizeText`.
- **Errors:**
  - Typed SDK errors map to the spec's messages: an authentication error means
    the key was not accepted; rate limit and connection errors mean the
    network failed.
  - A `refusal` stop reason means the model declined.
  - A `max_tokens` stop fails the run, like any other error; it is unlikely
    at 64,000 tokens for one page.
  - Cancel aborts the stream.
- **Cost:** a page is about 1–2K input tokens. A run with three attempts and
  thinking typically costs from a few cents up to about $0.50 at the model's
  $4 / $20 per million tokens.

### 9. Embedding plugin

- **Runtime:** `@huggingface/transformers` 4.3.2 in the worker, on the ONNX
  runtime's WebAssembly backend (CPU).
- **Model:** `Xenova/all-MiniLM-L6-v2`, 8-bit, 384 dimensions, pinned to commit
  `751bff3…`, with mean pooling and L2 normalization, so cosine similarity is
  a dot product. Embedding a page's worth of units takes a few hundred
  milliseconds.
- **The runtime is self-hosted.** The library's default fetches the ONNX
  runtime from a public CDN. Instead, the app serves the plain WebAssembly
  build from its own origin, imported with `?url` from a direct
  `onnxruntime-web` dependency at the library's exact version, so no
  third-party code runs.
  - The WebGPU builds were rejected: at 26.8 MB and 28.4 MB they exceed
    Cloudflare's 25 MiB per-file asset limit, and the CPU build is fast enough
    for one page.
- **Pinning covers every request.** The library builds some metadata URLs
  without the requested revision (they default to `main`). Setting
  `remotePathTemplate` to the pinned commit makes every Hub URL point at it.
  As a result, every file is a Cache Storage hit after the first download.
- **Download on request:** the model files (23.7 MB) come from Hugging Face,
  and the runtime (14.3 MB) from this app, only on Prepare. The library caches
  both in Cache Storage. Status reports ready when the model is cached, and
  then prefetches the library code while the page is online, so scoring works
  later without a network.
- **Alternatives rejected:**
  - Self-hosting the weights: it costs bandwidth for no privacy gain, since
    the weights are public.
  - A hosted embeddings API: it would send page text off the device by
    default.
- **Units:** units come from the existing line classes (`classifyLines`).
  Prose paragraphs are split into sentences, a list item starts a new
  paragraph, and each unit keeps its text span, so the codec can map scores
  to cells. A page has at most a few hundred units, so comparing every pair
  is cheap.
- **Calibration:** recorded in `calibration.md`. The 0.85 and 0.70 thresholds
  hold.

### 10. Build and loading

`vite.config.ts` makes four things hold in the production build:

- **Workers are ES modules** (`worker.format: "es"`). The worker shell
  (78 KB: protobuf runtime, transport, units, scoring) stays small, and the
  inference library (569 KB) is its own chunk, loaded on Prepare or Score.
- **Unused runtime files are dropped.** The library's bundled ONNX runtime
  references the WebGPU-capable WebAssembly builds. A build plugin removes
  them, because the 26.9 MB asyncify file exceeds Cloudflare's 25 MiB asset
  limit, and the app always loads its own plain build.
  - Aliasing the runtime to its CPU-only entry point was rejected: that entry
    point's built-in loader expects a window, so it fails in a worker.
- **The environment guard is kept.** The bundler treats `window` as a known
  browser global and folds the library's `typeof window !== "undefined" &&
  typeof window.document !== "undefined"` into `window.document !== void 0`,
  which throws in a worker.
  - A worker build plugin rewrites that one line to read through
    `globalThis`. It fails the build if a library update changes the line.
  - Disabling minification didn't help, because the folding happens before
    minification. Neither did the `neutral` platform.
- **No model code reaches the server bundle.** The registry import is
  guarded by `import.meta.env.SSR`, so the server build drops it.

The page checks Cache Storage directly to see whether a model is downloaded.
It starts the worker only if the model is downloaded, or when the author
downloads it. Someone who never uses a model loads none of its code.

### 11. Planes on the element and in the painter

- **Element API:** `setPlane(name, { text, values: Float32Array, label })` and
  `removePlane(name)`, shown with `lens="model:<name>"`.
- **Painting:** the painter gains an optional heat layer that tints each cell
  with alpha proportional to its value, on top of Ink styling, through the
  same path for Flat and the 3D texture.
- **Staleness check:** a plane is painted only when `plane.text === value`. A
  string comparison of up to about 5,000 characters per paint is negligible.
- **React wrapper:** `A4Sheet.tsx` gains a `planes` prop.
- **Shared mapping:** offset/cell mapping moves into `lib/tensor/`, and
  `pick.ts` uses it, so the renderers and the codec share one implementation.

## Risks / Trade-offs

- **[The 0.85 / 0.70 thresholds don't suit the chosen model]** → Calibrate
  during implementation on a fixture set of paraphrase and unrelated pairs. If
  the numbers must move, update this change's spec before archiving, so the
  spec always states the shipped values.
- **[The model download fails or is slow (host outage, CORS, metered
  connection)]** → Download only on explicit request, show the size first,
  allow retry, and keep the rest of the app unaffected. Pin the model revision.
- **[The library's own metadata lookups ignore the pinned revision]** → Pin
  `remotePathTemplate` to the commit, and verify offline scoring in a fresh
  browser profile.
- **[The sentence rule splits at abbreviations like "a.m."]** → Accepted for
  now and recorded in `calibration.md`. It costs a few restatements, never a
  false flag.
- **[The API key sits in browser memory]** → It is never persisted, the app
  loads no third-party scripts, and the opt-in is explicit. A
  Content-Security-Policy would harden this further (see Open Questions).
- **[A refusal fallback means another model sees the page]** → The text goes
  to the same destination, Anthropic, and the consent text discloses it.
- **[Module workers bundle differently under the vinext build]** → This
  happened. The production build broke the library's window guard, and
  emitted a runtime file over the asset limit. Both are fixed in
  `vite.config.ts` (see decision 10), and the fixes are verified in the
  production preview: the download and scoring both run in the worker.
- **[Bundle size grows]** → Measured in a fresh profile: startup JavaScript
  grew from 633 KB to 682 KB uncompressed (+49 KB). That's the protobuf
  runtime, generated schemas, the codec, and the Models panel. The SDK, the
  worker, the inference library, and the WebAssembly runtime load only on
  first use.
- **[Emoji and CJK take two cells]** → This matches the editor's existing
  known limitation, and README's Known limitations already covers it.

## Migration Plan

The change is additive. There is no stored data to migrate, and existing
pages, lenses, and the verdict are untouched. Deploy through the normal push
to main. To roll back, revert the deploy; no data written by this change needs
cleanup, because results are ordinary pages and the downloaded model is only
a browser cache.

## Open Questions

- Whether to add a Content-Security-Policy with a `connect-src` allowlist
  (self, `api.anthropic.com`, and the model host's download domains).
  Download domains can change, which makes an allowlist brittle. This can
  follow as a hardening change without altering the specs.
