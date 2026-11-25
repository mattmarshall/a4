/**
 * The sandbox an installed plugin runs in (design: add-signed-plugins,
 * decision 3; proven in experiments/plugin-sandbox/).
 *
 * - A hidden `<iframe sandbox="allow-scripts">` built from `srcdoc`. Its
 *   origin is opaque, so it has no storage, no cookies, and no access to the
 *   app.
 * - Its first element is a content security policy built from the plugin's
 *   frozen card: no network at all for an on-device plugin, or only the one
 *   HTTPS host a remote card names.
 * - Its only script is a bootstrap pinned by its hash. It takes one message
 *   from the app (the code, the start message, and a port), starts the code
 *   as a classic worker from a blob URL, and relays the worker's failures.
 * - The plugin runs only in that worker, which inherits the frame's policy.
 *   A worker can't navigate or open WebRTC connections, which a policy can't
 *   fully stop a document from doing.
 *
 * The app talks to the worker over the port with the worker transport, so
 * calls, cancels, and failures work as for the bundled worker plugin.
 * Removing the frame ends the worker.
 */

import { sha256 } from "../platform/digest.ts";
import type { PortLike } from "./worker-transport.ts";

/** Where a sandboxed plugin may connect: nowhere, or one HTTPS host. */
export type SandboxNetwork = "none" | { readonly host: string };

export interface SandboxOptions {
  /** The verified script to run. */
  readonly code: Uint8Array;
  /** The first message the worker gets with its port: `a4.v1.PluginStart` bytes. */
  readonly start: Uint8Array;
  readonly network: SandboxNetwork;
  /** For tests in development only: a policy to use instead of the one built from `network`. */
  readonly policyOverride?: string;
}

/** A port to a sandboxed plugin, and how to end it. */
export interface SandboxPort extends PortLike {
  close(): void;
}

const BOOT = `let started = false;
addEventListener("message", (event) => {
  if (started || event.source !== parent) return;
  started = true;
  const url = URL.createObjectURL(new Blob([event.data.code], { type: "text/javascript" }));
  const worker = new Worker(url);
  worker.addEventListener("error", (e) => {
    e.preventDefault();
    parent.postMessage({ kind: "error", message: e.message || "" }, "*");
  });
  worker.addEventListener("messageerror", () => parent.postMessage({ kind: "messageerror" }, "*"));
  worker.postMessage(event.data.start, [event.ports[0]]);
});`;

/** How long the frame may take to load before the plugin counts as failed to start. */
const LOAD_TIMEOUT_MS = 10_000;

let bootHash: Promise<string> | null = null;

function bootstrapHash(): Promise<string> {
  bootHash ??= sha256(new TextEncoder().encode(BOOT)).then((d) => btoa(String.fromCharCode(...d)));
  return bootHash;
}

/** The frame's policy for a plugin with `network`. */
async function sandboxPolicy(network: SandboxNetwork): Promise<string> {
  return [
    "default-src 'none'",
    `script-src 'sha256-${await bootstrapHash()}' blob: 'wasm-unsafe-eval'`,
    "worker-src blob:",
    `connect-src ${network === "none" ? "'none'" : `https://${network.host}`}`,
  ].join("; ");
}

/** An exact copy of `bytes` in its own buffer, safe to transfer. */
function ownBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

/** Start `code` in a sandbox and return a port to it, once the frame has loaded. */
export async function openSandbox(options: SandboxOptions): Promise<SandboxPort> {
  const policy = options.policyOverride ?? (await sandboxPolicy(options.network));
  // The policy is built from a validated hostname and fixed text, so it can't break out of the attribute.
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.hidden = true;
  frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><script>${BOOT}</script>`;
  const loaded = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The plugin’s sandbox didn’t start.")), LOAD_TIMEOUT_MS);
    frame.addEventListener(
      "load",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
  document.body.appendChild(frame);
  try {
    await loaded;
  } catch (error) {
    frame.remove();
    throw error;
  }
  const target = frame.contentWindow;
  if (!target) {
    frame.remove();
    throw new Error("The plugin’s sandbox didn’t start.");
  }

  const channel = new MessageChannel();
  const failureListeners: ((message: string) => void)[] = [];
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    window.removeEventListener("message", onFrameMessage);
    channel.port1.close();
    frame.remove();
  };
  const fail = (message: string) => {
    if (ended) return;
    end();
    for (const listener of failureListeners) listener(message);
  };
  const onFrameMessage = (event: MessageEvent) => {
    if (event.source !== target) return;
    const data = event.data as { kind?: string; message?: string } | null;
    if (data?.kind === "error") {
      fail(data.message ? `The plugin failed: ${data.message}` : "The plugin failed to start or crashed.");
    } else if (data?.kind === "messageerror") {
      fail("The plugin sent a message that couldn’t be read.");
    }
  };
  window.addEventListener("message", onFrameMessage);
  const code = ownBuffer(options.code);
  const start = ownBuffer(options.start);
  // An opaque origin can't be named, so "*": the message goes to this frame's window only.
  target.postMessage({ code, start }, "*", [channel.port2, code, start]);

  const port = channel.port1;
  return {
    postMessage: (message, transfer) => port.postMessage(message, transfer ?? []),
    addEventListener: (type, listener) => port.addEventListener(type, listener),
    removeEventListener: (type, listener) => port.removeEventListener(type, listener),
    start: () => port.start(),
    onFailure: (listener) => {
      failureListeners.push(listener);
    },
    close: end,
  };
}

/**
 * The self-test's plugin: it tries a `data:` fetch, which never leaves the
 * browser, in its worker and in a nested worker, and reports whether each
 * was refused.
 */
const CANARY = `self.addEventListener("message", (event) => {
  const port = event.ports[0];
  const direct = fetch("data:text/plain,a4").then(() => "reached", () => "refused");
  const nested = new Promise((resolve) => {
    try {
      const source = 'fetch("data:text/plain,a4").then(() => postMessage("reached"), () => postMessage("refused"));';
      const worker = new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
      worker.onmessage = (e) => resolve(e.data);
      worker.onerror = (e) => { e.preventDefault(); resolve("refused"); };
    } catch {
      resolve("refused");
    }
  });
  Promise.all([direct, nested]).then(([a, b]) => port.postMessage({ direct: a, nested: b }));
});`;

/** How long the self-test may take before it counts as failed. */
const SELF_TEST_TIMEOUT_MS = 5_000;

/**
 * Whether this browser enforces the sandbox's policy on the plugin's worker:
 * a plugin with no network tries to fetch, and must be refused, directly and
 * from a nested worker. No request leaves the browser either way. A timeout
 * or any error counts as not enforced, so installed plugins fail closed.
 */
export async function sandboxSelfTest(
  options: { readonly policyOverride?: string; readonly open?: typeof openSandbox } = {},
): Promise<boolean> {
  const open = options.open ?? openSandbox;
  let port: SandboxPort | null = null;
  try {
    port = await open({
      code: new TextEncoder().encode(CANARY),
      start: new Uint8Array(),
      network: "none",
      ...(options.policyOverride === undefined ? {} : { policyOverride: options.policyOverride }),
    });
    const opened = port;
    const result = await new Promise<{ direct?: unknown; nested?: unknown } | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), SELF_TEST_TIMEOUT_MS);
      opened.onFailure?.(() => resolve(null));
      opened.addEventListener("message", (event) => {
        clearTimeout(timer);
        resolve(event.data as { direct?: unknown; nested?: unknown });
      });
      opened.start?.();
    });
    return result?.direct === "refused" && result.nested === "refused";
  } catch {
    return false;
  } finally {
    port?.close();
  }
}

/** A policy that lets the canary reach anything: for development, to see installed plugins refused. */
export async function weakPolicyForTesting(): Promise<string> {
  return [
    "default-src 'none'",
    `script-src 'sha256-${await bootstrapHash()}' blob:`,
    "worker-src blob:",
    "connect-src * data:",
  ].join("; ");
}
