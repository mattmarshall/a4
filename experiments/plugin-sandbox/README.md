# Plugin sandbox experiment

Task 1.1 of the `add-signed-plugins` change: prove the sandbox from its design
(decision 3) before anything is built on it.

## What it does

The sandbox first ran here as a throwaway harness. It now lives in
`lib/models/sandbox.ts` (`openSandbox`), and this folder keeps the hostile
plugin and its results.

`hostile.js` is a plugin that tries every way out it can and reports each
attempt as "refused" or "reached". It runs under two policies:
- `connect-src 'none'`, for an on-device plugin;
- `connect-src https://example.com`, for a remote plugin with one host.

**To run it again:**
1. Start the dev server and the `plugin-sandbox-log` server from
   `.claude/launch.json`. The second one is `python3 -m http.server 5180`,
   which logs every request.
2. In the app's console at http://localhost:5173, run:

   ```js
   const m = await import("/lib/models/sandbox.ts");
   const code = (await import("/experiments/plugin-sandbox/hostile.js?raw")).default;
   const port = await m.openSandbox({ code: new TextEncoder().encode(code), start: new Uint8Array(), network: "none" });
   port.addEventListener("message", (e) => console.table(e.data));
   port.start();
   ```
3. Check the log server's output for `/leak`: a request that got out would
   show there.

## Results: Chromium, in the Claude desktop app's browser, 2026-11-25

| Attempt | `connect-src 'none'` | `connect-src https://example.com` |
| --- | --- | --- |
| `fetch` https://example.com (no-cors) | refused | **reached** (opaque) |
| `fetch` https://www.iana.org (no-cors) | refused | refused |
| `fetch` the local log server (`/leak`) | refused | refused |
| `fetch` a `data:` URL | refused | refused |
| `XMLHttpRequest` to another host | refused | refused |
| `WebSocket` to another host | refused | refused |
| `EventSource` to another host | refused | refused |
| `importScripts` from another host | refused | refused |
| A nested blob worker that fetches `data:` | refused | refused |
| `indexedDB.open` | refused (denied in this context) | refused |
| `caches.open` | refused (`caches` is not defined) | refused |
| `WebAssembly.compile` | reached | reached |

- **The worker's origin is `null`** (opaque), so it has no storage and
  shares nothing with the app.
- **Every refusal raised a `securitypolicyviolation` event** in the worker
  for `connect-src`, so the frame's policy governs the blob worker and its
  nested worker.
- **The log server shows no `/leak` request** under either policy. A control
  request from the page itself does show there, so the sandboxed request was
  blocked before it left the browser.
- **The app's network panel shows none of the worker's requests,** not even
  the allowed one. Use the server log and the violation events as evidence,
  not that panel.
- **WebAssembly compiles,** as `'wasm-unsafe-eval'` intends. Compiling code
  opens no network path.

## Conclusion

The sandbox in design decision 3 holds in Chromium. Task 5.1 built it into
`lib/models/sandbox.ts`, and the results above held through `openSandbox`
too. Firefox and Safari aren't covered here. The runtime self-test
(decision 4) refuses installed plugins in any browser that doesn't enforce
the policy on the worker.
