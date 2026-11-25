# Tasks

## 1. Prove the sandbox first

- [x] 1.1 Build a throwaway sandbox page in `experiments/plugin-sandbox/`. It should create a `sandbox="allow-scripts"` `srcdoc` frame with the CSP meta and the hash-pinned bootstrap from design decision 3, start a classic blob worker from it, and talk to it over a `MessagePort`. Load a hostile worker script that tries each of these:
  - `fetch` to an HTTPS host, and to a `data:` URL;
  - `WebSocket` and `EventSource`;
  - `importScripts` from an HTTPS URL;
  - a nested blob worker that fetches;
  - `indexedDB.open`.

  In the built-in browser (Chromium), verify each attempt is refused and no request appears in the network log. Verify a second policy, `connect-src https://example.com`, allows only that host. Record the results in `experiments/plugin-sandbox/README.md`. If Chromium doesn't enforce the policy on the worker, stop and revisit design decision 3 before going on.

## 2. The package format

- [x] 2.1 Add `proto/a4/v1/plugin.proto` with `PluginPackage`, `PluginManifest`, `Publisher`, `ModelFile`, `PluginStart`, `StartFile`, and `InstalledPlugin` (design decision 1). Run `pnpm proto`, and verify `pnpm proto:check` passes, with no breaking change to existing files.
- [x] 2.2 Add `verifyEd25519(publicKey, signature, data)` to `lib/platform/digest.ts`, through `crypto.subtle`. Add tests with RFC 8032 test vector 1 and with a signature that has one bit flipped, and verify they pass in Node.
- [x] 2.3 Add `lib/models/package.ts` with these:
  - `readPackage(bytes)`, which refuses anything over 16 MiB;
  - `verifyPackage(pkg)`, which checks the signature over the context prefix and the manifest bytes, the code digest, the version (`MAJOR.MINOR.PATCH`), the file list (HTTPS URLs, digests, and sizes that sum to `download_bytes`), and `checkPackagedCard`;
  - `checkPackagedCard`: the host's card checks, plus the id pattern, Score and Transform only, and a plain hostname for remote destinations;
  - `fingerprint(publicKey)`, as 8 groups of 4 hex digits.

  Add tests for every `plugin-packages` scenario that doesn't need the CLI: a one-byte manifest change, a signature from another key, swapped code, a 17 MiB package, version "latest", sizes that don't add up, a wildcard host, `Example/Word Length`, Generate, and two names with one key giving one fingerprint. Verify they pass.
- [x] 2.4 Add `lib/models/publishers.ts` with an empty `KNOWN_PUBLISHERS`, and `knownPublisher(publicKey)`. Test it against a fixture list, and verify that a known key gives the list's name and that a known name with another key gives none.

## 3. Publisher commands

- [x] 3.1 Add `cli/plugin.ts`: `a4 plugin keygen <file>`, `a4 plugin pack`, and `a4 plugin verify <file>` (design decision 10), with usage in `a4 --help`. Then:
  - Allow the `cli` → `lib/models/package.ts` import in `.dependency-cruiser.cjs`, the way `lib/desk/lint.ts` is allowed.
  - Add CLI tests for each `plugin-packages` command scenario:
    - keygen refuses an existing file and exits 2;
    - the key file's mode is 0600;
    - the private key never appears on stdout or stderr;
    - pack then verify exits 0, with the name and fingerprint;
    - pack refuses a Generate card and exits 1;
    - verify reports swapped code and exits 1.

  Verify they pass.
- [x] 3.2 Document the commands, the package format, the protocol, and the trust model in a new README section, "Third-party plugins". Verify that each documented command runs as written against the Word length example once group 4 lands.

## 4. The plugin kit and the examples

- [x] 4.1 Add `lib/models/kit/serve.ts`. It reads the first `PluginStart` message and its port, exposes `files(url)` and `credential(kind)`, and calls `servePort`. Test it over a Node `MessageChannel`: describe, score a page, and get the start files back. Verify it passes.
- [x] 4.2 Add `examples/plugins/word-length/`, an on-device overlay with one plane, "Word length": each cell holds its word's length over 12, capped at 1. Also add `examples/plugins/hard-wrap/`, an on-device pen with the instruction "Wrap at 72 columns" and most attempts 1. Add `scripts/build-example-plugins.ts`, which bundles each one into one IIFE script with Vite and packs it with a key it generates in the build output. Then:
  - Add `examples/` to knip's project and to `lint:deps`.
  - Test each example over a `MessageChannel`: Word length's plane values on a known page, and Hard wrap's output fitting the page.
  - Verify the build script writes two packages that pass `a4 plugin verify`.

## 5. The sandbox in the host

- [x] 5.1 Add `lib/models/sandbox.ts`, a `PortLike` over the frame and worker from task 1.1. Its CSP comes from the frozen card. It relays `error` and `messageerror` events to `onFailure`, and tears down by removing the frame. Replace the experiment's code with it, and verify the hostile checks from 1.1 still pass in the built-in browser through `sandbox.ts`.
- [x] 5.2 Add the self-test canary (design decision 4), run once per tab before the first installed plugin starts. Verify in the built-in browser that it passes. Then force a policy without `connect-src` in a test build, and verify that installed plugins show "This browser can't sandbox installed plugins" and none starts.
- [x] 5.3 Add the installed plugin’s client wrapper (design decision 5):
  - `prepare` downloads the manifest's files with progress, checks size and digest, and stores them;
  - `status` reports ready when the files are stored;
  - other calls start the sandbox with a `PluginStart` carrying the files and the declared credentials;
  - changing a credential restarts the sandbox.

  Test with a fake fetch and a fake sandbox port, and verify each case: a digest mismatch keeps nothing, a file with the wrong size keeps nothing, and the start message carries only the declared credential kinds.
- [x] 5.4 Add `ModelHost.unregister(id)`, which closes the client and drops its credentials and pending consent. Test it, and verify that calling an unregistered plugin fails with not-found.

## 6. Storing, installing, updating, and removing

- [x] 6.1 Add the `PluginStore` port in `lib/platform/plugin-store.ts`, with `IdbPluginStore` (database `a4-plugins`, stores `plugins` and `files`) and a memory fake. Write one contract suite. Run it against the memory fake in Node, and against `IdbPluginStore` in the built-in browser: Node has no IndexedDB, and `IdbHandleStore` has no Node test today either, so this adds no dependency. Verify both runs pass.
- [x] 6.2 Add `lib/models/installed.ts`, with `inspect(bytes, source)`, `install`, `update`, `remove`, and `loadInstalled` (design decisions 6 and 7). Add tests for each `installed-plugins` storage and trust scenario, and verify they pass:
  - a tampered file opens no dialog;
  - the same id from another key is refused;
  - a bundled id is refused;
  - an older version is refused;
  - an update that adds a destination is flagged;
  - stored code that changed is damaged and not registered;
  - removal deletes code, files, and pin, and keeps files another plugin lists.
- [x] 6.3 Register installed plugins in `registry.ts` after the bundled ones, from `loadInstalled`. Test, and verify:
  - a reload with a fake store registers Word length;
  - a damaged plugin isn't registered;
  - bundled plugins register first and unchanged.
- [x] 6.4 Add the URL install: an HTTPS-only fetch with no credentials and no referrer, a streamed 16 MiB cap, and an error that suggests installing from a file when the fetch fails. Check for update runs only on request. Test with a fake fetch, and verify: an HTTP URL makes no request, an oversized body is cut off at 16 MiB, and loading the store makes no request.

## 7. The app

- [x] 7.1 In the Models section, list cards from the host. For an installed plugin, show its publisher, fingerprint, and Known publisher badge or "Unknown publisher", and add Check for update (URL installs) and Remove. Verify in the built-in browser that bundled plugins look as before and an installed one shows its publisher.
- [x] 7.2 Add Install plugin (a file picker or an HTTPS URL), and the install and update dialogs from the `installed-plugins` spec: name, version, description, publisher, kind, where text goes, download size, credentials, and a changes list for updates. Add component tests for the dialog's text with a remote pen and with an update that adds a destination, and verify they pass.
- [x] 7.3 Generalize `useSemanticLens` into `useModelLens` (design decision 9):
  - lens keys are `model:<plugin id>/<plane>` for installed planes;
  - an on-device overlay rescores after 1,500 ms;
  - a remote overlay scores only on request, with consent;
  - the legend names the plugin and publisher.

  Verify the existing Semantic lens tests pass unchanged, and add tests for an installed overlay's key and for remote no-rescore.
- [x] 7.4 Generalize `fit-job.ts` into `pen-job.ts`, keep Fit to page's UI and its " (fit)" name, and add a generic pen row (instruction, Run, progress, Cancel). Results are named "<source> (<pen name>)", made unique. Verify that the existing fit-job tests pass as pen-job tests, and add tests for an installed pen's name and for a crash ending the run within 1 second with no page.

## 8. Docs and specs in the repository

- [x] 8.1 Update the README:
  - in "Model plugins", replace "Bundled plugins only" with where plugin code comes from;
  - finish "Third-party plugins" with installing, trust, the sandbox, updates, and removal.

  Update `docs/platform.md`: the Later item becomes roadmap step 5, built. Its "Still to come" covers the CLI and desk, Generate, key rotation, and the first known publisher. Verify that every relative link resolves and that `pnpm lint` passes.

## 9. End-to-end checks

- [x] 9.1 Run `pnpm check` and the CLI tests, and verify they pass.
- [x] 9.2 In the built-in browser, run the whole flow, and verify each step:
  - install Word length from its file, and confirm its lens tints a page and its legend names the plugin and "Unknown publisher";
  - reload, and the lens still works;
  - install Hard wrap and run it, and confirm "<page> (Hard wrap)" opens as page B with the source unchanged;
  - install a hostile test package, and confirm its requests are refused with none in the network log;
  - remove both, and confirm the page Hard wrap made remains;
  - see no console errors on a fresh load.

## Workflow follow-up

- Commit, push, and check the CI and deploy runs.
- Archive the change and sync its specs.
