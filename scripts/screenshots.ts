/**
 * Screenshots for style changes: capture a fixed set of views of a running
 * build in headless Chrome (over the DevTools protocol), and compare two
 * captures pixel by pixel.
 *
 *   pnpm build && pnpm start          # serves http://localhost:4173
 *   node scripts/screenshots.ts capture .screenshots/before
 *   node scripts/screenshots.ts capture .screenshots/after
 *   node scripts/screenshots.ts compare .screenshots/before .screenshots/after
 *
 * Options: --url <origin> (default http://localhost:4173), --chrome <path>,
 * --only <substring> (capture or compare matching views), --threshold <0–255> (a
 * channel difference that counts, default 8), --tolerance <fraction> (the
 * share of pixels allowed to differ, default 0.0005).
 *
 * Each view gets a fresh browser context, so storage is empty: the library
 * holds only the Welcome page, created "just now". Motion is reduced, nothing
 * keeps focus (no blinking caret), and WebGPU is off, so sheets render flat.
 * Print views also print to PDF and record the page count. `compare` writes a
 * `<view>.diff.png` beside each view that differs, and exits 1.
 */

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";

// ---------------------------------------------------------------------------
// Views

type Scheme = "light" | "dark";

interface View {
  readonly name: string;
  readonly path: string;
  readonly width: number;
  readonly height: number;
  readonly scheme: Scheme;
  /** Settings to seed, by key without the `a4:` prefix. */
  readonly settings?: Readonly<Record<string, string>>;
  /** Keys to press once the page is ready. */
  readonly keys?: readonly string[];
  /** Render with print media, and print to PDF too. */
  readonly print?: boolean;
}

const FLAT = { render: "flat" } as const;
const COMPARE = { render: "flat", mode: "compare" } as const;

function both(base: Omit<View, "name" | "scheme">, name: string): View[] {
  return (["light", "dark"] as const).map((scheme) => ({ ...base, name: `${name}-${scheme}`, scheme }));
}

const VIEWS: readonly View[] = [
  ...both({ path: "/", width: 1440, height: 900, settings: FLAT }, "single-1440"),
  ...both({ path: "/", width: 1440, height: 900, settings: COMPARE }, "compare-1440"),
  ...both({ path: "/", width: 1100, height: 800, settings: FLAT }, "single-1100"),
  ...both({ path: "/", width: 1100, height: 800, settings: COMPARE }, "compare-1100"),
  ...both(
    { path: "/", width: 900, height: 800, settings: { ...FLAT, library: "1", inspector: "0" } },
    "drawer-library-900",
  ),
  ...both(
    { path: "/", width: 900, height: 800, settings: { ...FLAT, library: "0", inspector: "1" } },
    "drawer-inspector-900",
  ),
  ...both({ path: "/", width: 1440, height: 900, settings: FLAT, keys: ["f"] }, "focus-1440"),
  ...(["syntax", "repetition", "structure", "tokens"] as const).flatMap((lens) =>
    both({ path: "/", width: 1440, height: 900, settings: { ...FLAT, lens } }, `lens-${lens}`),
  ),
  ...both({ path: "/", width: 1440, height: 900, settings: { ...FLAT, grid: "1", preset: "dense" } }, "grid-dense"),
  ...both({ path: "/why", width: 1440, height: 900 }, "why-1440"),
  ...both({ path: "/why", width: 900, height: 800 }, "why-900"),
  ...both({ path: "/element", width: 1440, height: 900 }, "element-1440"),
  { name: "print-single", path: "/", width: 1440, height: 900, scheme: "light", settings: FLAT, print: true },
  { name: "print-compare", path: "/", width: 1440, height: 900, scheme: "light", settings: COMPARE, print: true },
  { name: "print-element", path: "/element", width: 1440, height: 900, scheme: "light", print: true },
];

// ---------------------------------------------------------------------------
// A minimal DevTools protocol client

type Params = Record<string, unknown>;
type Message = {
  id?: number;
  method?: string;
  params?: Params;
  result?: Params;
  error?: { message: string };
  sessionId?: string;
};

class Cdp {
  readonly #ws: WebSocket;
  #next = 1;
  readonly #pending = new Map<number, { resolve: (r: Params) => void; reject: (e: Error) => void }>();
  readonly #waiters: { method: string; sessionId: string | undefined; resolve: (p: Params) => void }[] = [];

  private constructor(ws: WebSocket) {
    this.#ws = ws;
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data)) as Message;
      if (msg.id !== undefined) {
        const pending = this.#pending.get(msg.id);
        this.#pending.delete(msg.id);
        if (msg.error) pending?.reject(new Error(msg.error.message));
        else pending?.resolve(msg.result ?? {});
        return;
      }
      for (let i = this.#waiters.length - 1; i >= 0; i--) {
        const w = this.#waiters[i];
        if (w && w.method === msg.method && w.sessionId === msg.sessionId) {
          this.#waiters.splice(i, 1);
          w.resolve(msg.params ?? {});
        }
      }
    });
  }

  static async connect(url: string): Promise<Cdp> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error(`Couldn’t connect to ${url}`)), { once: true });
    });
    return new Cdp(ws);
  }

  send(method: string, params: Params = {}, sessionId?: string): Promise<Params> {
    const id = this.#next++;
    this.#ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }));
  }

  once(method: string, sessionId?: string, timeoutMs = 30_000): Promise<Params> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMs);
      this.#waiters.push({
        method,
        sessionId,
        resolve: (p) => {
          clearTimeout(timer);
          resolve(p);
        },
      });
    });
  }

  close() {
    this.#ws.close();
  }
}

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function launchChrome(path: string): Promise<{ wsUrl: string; stop: () => Promise<void> }> {
  const profile = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "a4-screenshots-"));
  const chrome = spawn(
    path,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-color-profile=srgb",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const wsUrl = await new Promise<string>((resolve, reject) => {
    let log = "";
    chrome.stderr.on("data", (chunk: Buffer) => {
      log += chunk.toString();
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(log);
      if (m?.[1]) resolve(m[1]);
    });
    chrome.on("exit", (code) => reject(new Error(`Chrome exited (${code}) before it was ready:\n${log}`)));
  });
  return {
    wsUrl,
    stop: async () => {
      // Chrome writes to its profile while it shuts down: wait for it to exit before removing it.
      const exited = new Promise((resolve) => chrome.once("exit", resolve));
      chrome.kill();
      await exited;
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run `expression` in the page and return its value. */
async function evaluate(cdp: Cdp, session: string, expression: string): Promise<unknown> {
  const r = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, session);
  const result = r.result as { value?: unknown } | undefined;
  return result?.value;
}

/** Wait until fonts are in, sheets have settled on a rendering, and nothing has changed for a moment. */
const SETTLE = `(async () => {
  await document.fonts.ready;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const sheets = [...document.querySelectorAll("a4-sheet")];
    if (sheets.every((s) => s.render)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 1200));
  document.activeElement?.blur?.();
  for (const s of document.querySelectorAll("a4-sheet")) s.shadowRoot?.activeElement?.blur?.();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return true;
})()`;

function pdfPages(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}

async function captureView(cdp: Cdp, origin: string, view: View, dir: string): Promise<{ pdfPages?: number }> {
  const { browserContextId } = (await cdp.send("Target.createBrowserContext")) as { browserContextId: string };
  const { targetId } = (await cdp.send("Target.createTarget", { url: "about:blank", browserContextId })) as {
    targetId: string;
  };
  const { sessionId } = (await cdp.send("Target.attachToTarget", { targetId, flatten: true })) as {
    sessionId: string;
  };
  try {
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: view.width, height: view.height, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
    await cdp.send(
      "Emulation.setEmulatedMedia",
      {
        media: "screen",
        features: [
          { name: "prefers-color-scheme", value: view.scheme },
          { name: "prefers-reduced-motion", value: "reduce" },
        ],
      },
      sessionId,
    );
    const seed = JSON.stringify(view.settings ?? {});
    await cdp.send(
      "Page.addScriptToEvaluateOnNewDocument",
      {
        source: `if (location.origin === ${JSON.stringify(origin)}) {
          for (const [k, v] of Object.entries(${seed})) localStorage.setItem("a4:" + k, v);
        }`,
      },
      sessionId,
    );
    const loaded = cdp.once("Page.loadEventFired", sessionId);
    await cdp.send("Page.navigate", { url: origin + view.path }, sessionId);
    await loaded;
    await evaluate(cdp, sessionId, SETTLE);
    for (const key of view.keys ?? []) {
      for (const type of ["keyDown", "keyUp"]) {
        await cdp.send("Input.dispatchKeyEvent", { type, key, text: type === "keyDown" ? key : undefined }, sessionId);
      }
      await sleep(400);
    }
    const out: { pdfPages?: number } = {};
    if (view.print) {
      await cdp.send(
        "Emulation.setEmulatedMedia",
        { media: "print", features: [{ name: "prefers-color-scheme", value: view.scheme }] },
        sessionId,
      );
      await sleep(400);
    }
    const shot = (await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId)) as { data: string };
    writeFileSync(join(dir, `${view.name}.png`), Buffer.from(shot.data, "base64"));
    if (view.print) {
      const pdf = (await cdp.send("Page.printToPDF", { preferCSSPageSize: true }, sessionId)) as { data: string };
      const bytes = Buffer.from(pdf.data, "base64");
      writeFileSync(join(dir, `${view.name}.pdf`), bytes);
      out.pdfPages = pdfPages(bytes);
    }
    return out;
  } finally {
    await cdp.send("Target.closeTarget", { targetId });
    await cdp.send("Target.disposeBrowserContext", { browserContextId });
  }
}

async function capture(dir: string, options: { url: string; chrome: string; only: string | undefined }) {
  mkdirSync(dir, { recursive: true });
  const views = VIEWS.filter((v) => !options.only || v.name.includes(options.only));
  const { wsUrl, stop } = await launchChrome(options.chrome);
  const cdp = await Cdp.connect(wsUrl);
  const manifest: Record<string, { width: number; height: number; pdfPages?: number }> = {};
  try {
    for (const view of views) {
      let result: { pdfPages?: number };
      try {
        result = await captureView(cdp, options.url, view, dir);
      } catch (error) {
        // A view that times out once (a slow first load, say) gets one more try.
        console.log(`${view.name}: ${error instanceof Error ? error.message : String(error)}; trying again`);
        result = await captureView(cdp, options.url, view, dir);
      }
      manifest[view.name] = { width: view.width, height: view.height, ...result };
      console.log(`${view.name}${result.pdfPages !== undefined ? ` (${result.pdfPages}-page PDF)` : ""}`);
    }
  } finally {
    cdp.close();
    await stop();
  }
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Captured ${views.length} views in ${dir}`);
}

// ---------------------------------------------------------------------------
// PNG: just enough to read Chrome's screenshots and write a diff image

interface Image {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel. */
  data: Uint8Array;
}

/** The PNG Paeth predictor: whichever of left, up, and up-left is closest to left + up − up-left. */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function decodePng(file: Buffer): Image {
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString("latin1", offset + 4, offset + 8);
    const body = file.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8];
      colorType = body[9] ?? 0;
      if (depth !== 8 || (colorType !== 2 && colorType !== 6) || body[12] !== 0) {
        throw new Error(`Unsupported PNG (depth ${depth}, color type ${colorType}, interlace ${body[12]})`);
      }
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? (pixels[row + x - bpp] ?? 0) : 0;
      const b = y > 0 ? (pixels[row - stride + x] ?? 0) : 0;
      const c = x >= bpp && y > 0 ? (pixels[row - stride + x - bpp] ?? 0) : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) predictor = paeth(a, b, c);
      pixels[row + x] = ((raw[src + x] ?? 0) + predictor) & 255;
    }
  }
  if (bpp === 4) return { width, height, data: pixels };
  const data = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < pixels.length; i += 3, j += 4) {
    data[j] = pixels[i] ?? 0;
    data[j + 1] = pixels[i + 1] ?? 0;
    data[j + 2] = pixels[i + 2] ?? 0;
    data[j + 3] = 255;
  }
  return { width, height, data };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "latin1");
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([head.subarray(4), body])) crc = (CRC_TABLE[(crc ^ byte) & 255] ?? 0) ^ (crc >>> 8);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
  return Buffer.concat([head, body, tail]);
}

function encodePng(image: Image): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const stride = image.width * 4;
  const raw = Buffer.alloc(image.height * (stride + 1));
  for (let y = 0; y < image.height; y++)
    raw.set(image.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Compare

interface Difference {
  readonly differing: number;
  readonly total: number;
  readonly diff: Image;
}

function difference(a: Image, b: Image, threshold: number): Difference {
  const diff: Image = { width: a.width, height: a.height, data: new Uint8Array(a.data.length) };
  let differing = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.max(
      Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0)),
      Math.abs((a.data[i + 1] ?? 0) - (b.data[i + 1] ?? 0)),
      Math.abs((a.data[i + 2] ?? 0) - (b.data[i + 2] ?? 0)),
    );
    // Faded background, with the differing pixels in red.
    const gray = ((a.data[i] ?? 0) + (a.data[i + 1] ?? 0) + (a.data[i + 2] ?? 0)) / 3;
    const faded = 200 + gray / 5;
    if (d > threshold) {
      differing++;
      diff.data.set([255, 0, 0, 255], i);
    } else {
      diff.data.set([faded, faded, faded, 255], i);
    }
  }
  return { differing, total: a.width * a.height, diff };
}

function compare(
  dirA: string,
  dirB: string,
  options: { threshold: number; tolerance: number; only: string | undefined },
): boolean {
  type Manifest = Record<string, { width: number; height: number; pdfPages?: number }>;
  const a = JSON.parse(readFileSync(join(dirA, "manifest.json"), "utf8")) as Manifest;
  const b = JSON.parse(readFileSync(join(dirB, "manifest.json"), "utf8")) as Manifest;
  let ok = true;
  for (const name of Object.keys(a).filter((n) => !options.only || n.includes(options.only))) {
    const before = a[name];
    const after = b[name];
    if (!after) {
      console.log(`✗ ${name}: missing from ${dirB}`);
      ok = false;
      continue;
    }
    if (before?.pdfPages !== after.pdfPages) {
      console.log(`✗ ${name}: the PDF has ${after.pdfPages} pages, not ${before?.pdfPages}`);
      ok = false;
    }
    const imgA = decodePng(readFileSync(join(dirA, `${name}.png`)));
    const imgB = decodePng(readFileSync(join(dirB, `${name}.png`)));
    if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
      console.log(`✗ ${name}: ${imgB.width}×${imgB.height}, not ${imgA.width}×${imgA.height}`);
      ok = false;
      continue;
    }
    const { differing, total, diff } = difference(imgA, imgB, options.threshold);
    const share = differing / total;
    const pass = share <= options.tolerance;
    const pdf = before?.pdfPages !== undefined ? `, ${after.pdfPages}-page PDF` : "";
    console.log(`${pass ? "✓" : "✗"} ${name}: ${differing} pixels differ (${(share * 100).toFixed(3)}%)${pdf}`);
    if (!pass) {
      ok = false;
      writeFileSync(join(dirB, `${name}.diff.png`), encodePng(diff));
    }
  }
  return ok;
}

// ---------------------------------------------------------------------------

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const positional = rest.filter((arg, i) => !arg.startsWith("--") && !rest[i - 1]?.startsWith("--"));
  if (command === "capture" && positional[0]) {
    await capture(positional[0], {
      url: option(rest, "url") ?? "http://localhost:4173",
      chrome: option(rest, "chrome") ?? CHROME,
      only: option(rest, "only"),
    });
    return;
  }
  if (command === "compare" && positional[0] && positional[1]) {
    const ok = compare(positional[0], positional[1], {
      threshold: Number(option(rest, "threshold") ?? 8),
      tolerance: Number(option(rest, "tolerance") ?? 0.0005),
      only: option(rest, "only"),
    });
    process.exitCode = ok ? 0 : 1;
    return;
  }
  console.error("Usage: node scripts/screenshots.ts capture <dir> | compare <before> <after>");
  process.exitCode = 2;
}

await main();
