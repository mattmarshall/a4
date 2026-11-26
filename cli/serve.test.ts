import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { request } from "node:http";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { create, toBinary } from "@bufbuild/protobuf";
import { ReadPageRequestSchema, WritePageRequestSchema } from "../lib/gen/a4/v1/store_pb.js";
import { RemotePageStore } from "../lib/persist/store/remote.ts";
import { pageStoreContract } from "../lib/persist/store/testing/contract.ts";
import { APP_ORIGIN, type RunningServer, startServer, TOKEN_FILE } from "./serve.ts";

const folders: string[] = [];
const servers: RunningServer[] = [];

after(async () => {
  await Promise.all(servers.map((s) => s.close()));
  await Promise.all(folders.map((f) => rm(f, { recursive: true, force: true })));
});

async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "a4-serve-"));
  folders.push(dir);
  return dir;
}

/** `a4 serve` on a free port over `dir` (a new folder by default), closed after the run. */
async function serve(dir?: string, options: { origins?: string[]; newToken?: boolean; port?: number } = {}) {
  const running = await startServer({
    folder: dir ?? (await folder()),
    port: options.port ?? 0,
    origins: options.origins ?? [],
    newToken: options.newToken ?? false,
  });
  servers.push(running);
  return running;
}

/** The store the app would make for `running`, sending the app's origin as a browser would. */
function client(running: RunningServer, token = running.token): RemotePageStore {
  return new RemotePageStore({
    base: `http://${running.address}`,
    token,
    fetch: (input, init) => fetch(input, { ...init, headers: { ...(init?.headers as object), origin: APP_ORIGIN } }),
  });
}

interface Answer {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: Buffer;
}

/** One raw request, with exactly these headers (Host included). */
function raw(
  running: RunningServer,
  options: { method?: string; path?: string; headers?: Record<string, string>; body?: Uint8Array },
): Promise<Answer> {
  const [, port] = running.address.split(":");
  return new Promise((done, fail) => {
    const req = request(
      {
        host: "127.0.0.1",
        port: Number(port),
        method: options.method ?? "POST",
        path: options.path ?? "/a4.v1.PageStoreService/ReadPage",
        headers: options.headers ?? {},
        setHost: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => done({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      },
    );
    req.on("error", fail);
    req.end(options.body ? Buffer.from(options.body) : undefined);
  });
}

const good = (running: RunningServer) => ({
  host: running.address,
  origin: APP_ORIGIN,
  authorization: `Bearer ${running.token}`,
  "content-type": "application/proto",
});

pageStoreContract("remote store over a running a4 serve", async () => client(await serve()), {
  tabs: async () => {
    const running = await serve();
    return [client(running), client(running)] as const;
  },
});

test("it listens on 127.0.0.1 only", async () => {
  const running = await serve();
  const address = running.server.address();
  assert.ok(address && typeof address === "object");
  assert.equal(address.address, "127.0.0.1");
  assert.match(running.links[0] ?? "", /^https:\/\/a4\.marsh\.build\/#serve=127\.0\.0\.1:\d+\.[A-Za-z0-9_-]{43}$/);
});

test("refused requests read and write nothing", async () => {
  const dir = await folder();
  const running = await serve(dir);
  await writeFile(join(dir, "pages", "Brief.md"), "secret text");
  const before = await readdir(join(dir, "pages"));
  const read = toBinary(ReadPageRequestSchema, create(ReadPageRequestSchema, { name: "Brief" }));
  const write = toBinary(
    WritePageRequestSchema,
    create(WritePageRequestSchema, { name: "Brief", text: "overwritten" }),
  );
  const cases: [string, Record<string, string>, number][] = [
    ["a wrong token", { ...good(running), authorization: "Bearer nope" }, 401],
    ["no token", { host: running.address, origin: APP_ORIGIN }, 401],
    ["another origin", { ...good(running), origin: "https://attacker.example" }, 403],
    ["no origin", { host: running.address, authorization: `Bearer ${running.token}` }, 403],
    [
      "another host (DNS rebinding)",
      { ...good(running), host: `attacker.example:${running.address.split(":")[1]}` },
      403,
    ],
  ];
  for (const [label, headers, status] of cases) {
    for (const [path, body] of [
      ["/a4.v1.PageStoreService/ReadPage", read],
      ["/a4.v1.PageStoreService/WritePage", write],
    ] as const) {
      const answer = await raw(running, { path, headers, body });
      assert.equal(answer.status, status, `${label}: ${path}`);
      assert.equal(answer.body.length, 0, `${label}: ${path} sends nothing back`);
    }
  }
  assert.equal(await readFile(join(dir, "pages", "Brief.md"), "utf8"), "secret text");
  assert.deepEqual(await readdir(join(dir, "pages")), before);
  // The same read with every check passed does reach the page.
  const allowed = await raw(running, { headers: good(running), body: read });
  assert.equal(allowed.status, 200);
  assert.match(allowed.body.toString("utf8"), /secret text/);
});

test("preflights are answered for allowed origins only, with private network access", async () => {
  const running = await serve(undefined, { origins: ["http://localhost:5173"] });
  const ask = (origin: string) =>
    raw(running, {
      method: "OPTIONS",
      headers: {
        host: running.address,
        origin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization, content-type",
        "access-control-request-private-network": "true",
      },
    });
  for (const origin of [APP_ORIGIN, "http://localhost:5173"]) {
    const answer = await ask(origin);
    assert.equal(answer.status, 204);
    assert.equal(answer.headers["access-control-allow-origin"], origin);
    assert.equal(answer.headers["access-control-allow-private-network"], "true");
    assert.match(String(answer.headers["access-control-allow-headers"]), /authorization/);
  }
  const refused = await ask("https://attacker.example");
  assert.equal(refused.status, 403);
  assert.equal(refused.headers["access-control-allow-origin"], undefined);
  assert.equal(running.links.length, 2);
});

test("the token is kept owner-only, reused across runs, and replaced by --new-token", async () => {
  const dir = await folder();
  const first = await serve(dir);
  await first.close();
  const mode = (await stat(join(dir, TOKEN_FILE))).mode & 0o777;
  assert.equal(mode, 0o600);
  const second = await serve(dir);
  assert.equal(second.token, first.token);
  await second.close();
  const third = await serve(dir, { newToken: true });
  assert.notEqual(third.token, first.token);
  assert.equal((await readFile(join(dir, TOKEN_FILE), "utf8")).trim(), third.token);
  // The old token no longer opens the library.
  await assert.rejects(client(third, first.token).list(), /refused/);
  assert.deepEqual(await client(third).list(), []);
});

test("a taken port, a file for a folder, and a bad --origin are refused", async () => {
  const running = await serve();
  const port = Number(running.address.split(":")[1]);
  await assert.rejects(serve(undefined, { port }), /Port \d+ is taken/);
  const dir = await folder();
  await writeFile(join(dir, "file.md"), "x");
  await assert.rejects(serve(join(dir, "file.md")), /isn’t a folder/);
  await assert.rejects(serve(undefined, { origins: ["localhost:5173"] }), /--origin takes an origin/);
  await assert.rejects(serve(undefined, { origins: ["http://localhost:5173/app"] }), /--origin takes an origin/);
});

/** Run `a4 serve` for real; resolves with its exit status and output once it exits. */
function runCli(args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const cli = fileURLToPath(new URL("./a4.ts", import.meta.url));
  return new Promise((done) => {
    const child = spawn(process.execPath, [cli, "serve", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => {
      stdout += c.toString("utf8");
      // Once it says where it's serving, stop it as Ctrl-C would.
      if (stdout.includes("#serve=")) child.kill("SIGINT");
    });
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString("utf8");
    });
    child.on("close", (status) => done({ status, stdout, stderr }));
  });
}

test("a4 serve prints the connect link and stops on Ctrl-C; a taken port exits 2", async () => {
  const dir = await folder();
  const ok = await runCli([dir, "--port", "0", "--origin", "http://localhost:5173"]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /https:\/\/a4\.marsh\.build\/#serve=127\.0\.0\.1:\d+\./);
  assert.match(ok.stdout, /http:\/\/localhost:5173\/#serve=/);
  const running = await serve();
  const taken = await runCli([dir, "--port", running.address.split(":")[1] ?? ""]);
  assert.equal(taken.status, 2);
  assert.match(taken.stderr, /is taken/);
});
