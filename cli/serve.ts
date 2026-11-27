/**
 * `a4 serve <folder> [--port <n>] [--origin <url>]... [--new-token]`: serve a
 * page library kept as Markdown files to the app on this machine (README,
 * "Served library").
 *
 * - Pages are `<folder>/pages/<name>.md`, trashed pages `<folder>/trash/`,
 *   kept by the same store as the browser's OPFS library.
 * - It listens on 127.0.0.1 only, and answers a request only when its Host is
 *   that address (or localhost) with this port, it comes from an allowed
 *   origin (https://a4.marsh.build, and any --origin), and it carries the
 *   library's token, kept in `<folder>/.a4-serve-token` and reused across runs.
 * - It never logs page text.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import {
  APP_ORIGIN,
  connectLink,
  DEFAULT_SERVE_PORT,
  isLibraryId,
  isServedToken,
  type LibraryId,
  type StoreHandlers,
} from "../lib/persist/index.ts";
import { openFolderLibrary } from "../lib/persist/store/node-handle.ts";
import { folderFailure, handleStoreCall, STORE_PATH, storeHandlers } from "../lib/persist/store/serve.ts";
import { UsageError } from "./usage.ts";

export interface ServeArgs {
  readonly folder: string;
  readonly port: number;
  /** Origins allowed besides https://a4.marsh.build. */
  readonly origins: readonly string[];
  readonly newToken: boolean;
}

export { APP_ORIGIN };

/** The port `a4 serve` listens on unless told otherwise. */
export const DEFAULT_PORT = DEFAULT_SERVE_PORT;

/** The token file, beside the pages. */
export const TOKEN_FILE = ".a4-serve-token";

/** The library's id file, beside the pages: made once, kept across restarts and new tokens. */
export const LIBRARY_FILE = ".a4-library";

/** The largest request body accepted: a page and its envelope. */
const MAX_BODY_BYTES = 16 * 1024 * 1024;

/** The library's token: the one in the folder, or a new one (32 random bytes) written there, readable only by its owner. */
async function libraryToken(folder: string, fresh: boolean): Promise<string> {
  const path = join(folder, TOKEN_FILE);
  if (!fresh) {
    const existing = (await readFile(path, "utf8").catch(() => "")).trim();
    if (isServedToken(existing)) {
      await chmod(path, 0o600);
      return existing;
    }
  }
  const token = randomBytes(32).toString("base64url");
  await writeFile(path, `${token}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
  return token;
}

/**
 * The library's id: the one in the folder, or a new one (16 random bytes)
 * written there once, with an exclusive create so two servers starting at
 * once agree on it. It's an id, not a secret. A file that doesn't hold an id
 * stops the server: replacing it would orphan the library's drafts.
 */
async function libraryId(folder: string): Promise<LibraryId> {
  const path = join(folder, LIBRARY_FILE);
  const fresh = randomBytes(16).toString("base64url");
  await writeFile(path, `${fresh}\n`, { flag: "wx", mode: 0o644 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  const id = (await readFile(path, "utf8")).trim();
  if (!isLibraryId(id)) {
    throw new Error(
      `“${LIBRARY_FILE}” in ${folder} doesn’t hold a library id. Delete it to give the library a new one.`,
    );
  }
  return id;
}

function sameSecret(given: string, token: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function body(req: IncomingMessage): Promise<Uint8Array | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

export interface RunningServer {
  /** "127.0.0.1:<port>". */
  readonly address: string;
  readonly token: string;
  /** The library's id, from `.a4-library`. */
  readonly library: LibraryId;
  /** One connect link per allowed origin, the app's first. */
  readonly links: readonly string[];
  readonly server: Server;
  close(): Promise<void>;
}

/** The request handler: Host, then Origin and preflight, then the token, then the store call. */
function handler(handlers: StoreHandlers, port: () => number, origins: ReadonlySet<string>, token: string) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const host = req.headers.host ?? "";
    if (host !== `127.0.0.1:${port()}` && host !== `localhost:${port()}`) {
      res.writeHead(403).end();
      return;
    }
    const origin = req.headers.origin;
    if (!origin || !origins.has(origin)) {
      res.writeHead(403).end();
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "POST");
      res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
      res.setHeader("Access-Control-Max-Age", "600");
      if (req.headers["access-control-request-private-network"]) {
        res.setHeader("Access-Control-Allow-Private-Network", "true");
      }
      res.writeHead(204).end();
      return;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method !== "POST" || !url.pathname.startsWith(STORE_PATH)) {
      res.writeHead(404).end();
      return;
    }
    const auth = req.headers.authorization ?? "";
    if (!auth.startsWith("Bearer ") || !sameSecret(auth.slice("Bearer ".length), token)) {
      res.writeHead(401).end();
      return;
    }
    const bytes = await body(req);
    if (!bytes) {
      res.writeHead(413).end();
      return;
    }
    const method = url.pathname.slice(STORE_PATH.length);
    try {
      const result = await handleStoreCall(handlers, method, bytes);
      res.writeHead(result.status, { "content-type": "application/proto" }).end(Buffer.from(result.body));
    } catch (error) {
      // A failure outside the store's typed errors (the disk is full, a permission changed): log its
      // code, and answer with it, never saying what the page held.
      const code = errorCode(error);
      process.stderr.write(`a4 serve: ${method} failed (${code}).\n`);
      const failed = folderFailure(code);
      res.writeHead(failed.status, { "content-type": "application/proto" }).end(Buffer.from(failed.body));
    }
  };
}

/** A failure's code for the log: a Node error's code (ENOSPC, EACCES), else its name. Never its message. */
function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
  return error instanceof Error ? error.name : "unknown";
}

/**
 * Run `handle` for each request so nothing it does can reject unhandled: a
 * client that goes away mid-request (a tab closed during a save) aborts its
 * body, and that must end the request, not the server.
 */
function guarded(handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>) {
  return (req: IncomingMessage, res: ServerResponse) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(400).end();
      else res.destroy();
    });
  };
}

/** Start serving `folder`: resolves once listening. Port 0 picks a free port (tests). */
export async function startServer(args: ServeArgs): Promise<RunningServer> {
  const folder = resolve(args.folder);
  const found = await stat(folder).catch(() => null);
  if (found && !found.isDirectory()) throw new UsageError(`“${args.folder}” isn’t a folder.`);
  await mkdir(folder, { recursive: true });
  for (const origin of args.origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new UsageError(`--origin takes an origin like http://localhost:5173, not “${origin}”.`);
    }
    if (parsed.origin !== origin.replace(/\/+$/, "")) {
      throw new UsageError(`--origin takes an origin like http://localhost:5173, not “${origin}”.`);
    }
  }
  const origins = new Set([APP_ORIGIN, ...args.origins.map((o) => o.replace(/\/+$/, ""))]);
  // The id first: a damaged id file stops the server before --new-token disconnects every browser.
  const library = await libraryId(folder);
  const token = await libraryToken(folder, args.newToken);
  const store = await openFolderLibrary(folder);
  let port = args.port;
  const server = createServer(guarded(handler(storeHandlers(store, library), () => port, origins, token)));
  await new Promise<void>((done, fail) => {
    server.once("error", (error: NodeJS.ErrnoException) =>
      fail(error.code === "EADDRINUSE" ? new Error(`Port ${args.port} is taken. Choose another with --port.`) : error),
    );
    server.listen(args.port, "127.0.0.1", () => done());
  });
  const listening = server.address();
  port = typeof listening === "object" && listening ? listening.port : args.port;
  const address = `127.0.0.1:${port}`;
  return {
    address,
    token,
    library,
    links: [...origins].map((o) => connectLink(o, { address, token })),
    server,
    close: () =>
      new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      }),
  };
}

/** Serve until interrupted. Exit status: 0 when stopped, 2 for a folder or port that can't be used. */
export async function runServe(args: ServeArgs): Promise<number> {
  const running = await startServer(args);
  // Listen before printing the link, so a Ctrl-C the moment it appears still closes the server, and keep
  // listening while it closes, so a second Ctrl-C doesn't kill the process mid-close.
  const stopped = new Promise<void>((done) => {
    let closing = false;
    const stop = () => {
      if (closing) return;
      closing = true;
      void running.close().then(() => {
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
        done();
      });
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
  process.stdout.write(
    [
      `Serving the library in ${resolve(args.folder)}`,
      `at http://${running.address} (this machine only). Stop with Ctrl-C.`,
      "",
      "To connect A4, open:",
      ...running.links.map((l) => `  ${l}`),
      "",
      "The link holds the library's token: anyone with it can read and change these pages.",
      "",
    ].join("\n"),
  );
  await stopped;
  return 0;
}
