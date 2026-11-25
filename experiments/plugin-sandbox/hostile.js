// A hostile plugin: it tries every way out of the sandbox it can think of and
// reports each result over the port the bootstrap hands it. "refused" means the
// attempt failed inside the worker; "reached" means it got through.

const violations = [];
self.addEventListener("securitypolicyviolation", (event) => {
  violations.push(`${event.effectiveDirective} ${event.blockedURI}`);
});

const outcome = async (attempt) => {
  try {
    const detail = await attempt();
    return { result: "reached", detail: String(detail ?? "") };
  } catch (error) {
    return { result: "refused", detail: String(error?.message ?? error) };
  }
};

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms))]);

const ALLOWED = "https://example.com/";
const OTHER = "https://www.iana.org/";

async function probes() {
  const results = {};
  results["fetch allowed host (no-cors)"] = await outcome(async () => {
    const r = await fetch(ALLOWED, { mode: "no-cors" });
    return r.type;
  });
  results["fetch other host (no-cors)"] = await outcome(async () => {
    const r = await fetch(OTHER, { mode: "no-cors" });
    return r.type;
  });
  results["fetch data: URL"] = await outcome(async () => (await fetch("data:text/plain,a4")).text());
  // The experiment server (python3 -m http.server 5180) logs every request, so a leak shows up in its log.
  results["fetch the local log server"] = await outcome(async () => {
    const r = await fetch("http://localhost:5180/leak?from=sandbox", { mode: "no-cors" });
    return r.type;
  });
  results["XMLHttpRequest other host"] = await outcome(
    () =>
      new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", OTHER);
        xhr.onload = () => resolve(xhr.status);
        xhr.onerror = () => reject(new Error("xhr error"));
        xhr.send();
      }),
  );
  results["WebSocket other host"] = await outcome(() =>
    withTimeout(
      new Promise((resolve, reject) => {
        const ws = new WebSocket("wss://www.iana.org/");
        ws.onopen = () => resolve("open");
        ws.onerror = () => reject(new Error("socket error"));
      }),
      3000,
    ),
  );
  results["EventSource other host"] = await outcome(() =>
    withTimeout(
      new Promise((resolve, reject) => {
        const source = new EventSource(OTHER);
        source.onopen = () => resolve("open");
        source.onerror = () => {
          source.close();
          reject(new Error("event source error"));
        };
      }),
      3000,
    ),
  );
  results["importScripts other host"] = await outcome(() => {
    importScripts(`${OTHER}x.js`);
    return "loaded";
  });
  results["nested blob worker fetches data:"] = await outcome(() =>
    withTimeout(
      new Promise((resolve, reject) => {
        const source = `fetch("data:text/plain,a4").then(() => postMessage("reached"), (e) => postMessage("refused: " + e.message));`;
        const nested = new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
        nested.onmessage = (event) =>
          String(event.data).startsWith("reached") ? resolve(event.data) : reject(new Error(event.data));
        nested.onerror = (event) => {
          event.preventDefault();
          reject(new Error(`nested worker failed: ${event.message}`));
        };
      }),
      3000,
    ),
  );
  results["indexedDB.open"] = await outcome(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("hostile");
        request.onsuccess = () => resolve("opened");
        request.onerror = () => reject(request.error ?? new Error("open failed"));
      }),
  );
  results["caches.open"] = await outcome(async () => {
    await caches.open("hostile");
    return "opened";
  });
  results["WebAssembly.compile"] = await outcome(async () => {
    // The smallest valid module: magic and version.
    await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
    return "compiled";
  });
  results.origin = { result: "info", detail: self.origin };
  results.violations = { result: "info", detail: violations.join("; ") };
  return results;
}

self.addEventListener(
  "message",
  (event) => {
    const port = event.ports[0];
    void probes().then((results) => port.postMessage(results));
  },
  { once: true },
);
