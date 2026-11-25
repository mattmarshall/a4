import { after, test } from "node:test";
import assert from "node:assert/strict";
import { create } from "@bufbuild/protobuf";
import {
  type ModelCard,
  ModelCardSchema,
  type PrepareResponse,
  PrepareRequestSchema,
  ScoreRequestSchema,
  StatusRequestSchema,
} from "../gen/a4/v1/model_pb.js";
import { PRESETS } from "../page/index.ts";
import { sheetRecord } from "../tensor/record.ts";
import { closeClient, type SheetModelClient } from "./client.ts";
import { ErrorCode, isModelError } from "./errors.ts";
import { installedClient, NO_SANDBOX, type PluginFiles } from "./installed-client.ts";
import { digestUrn, verifyPackage } from "./package.ts";
import { overlayCard, penCard, rawPackage, testKey } from "./testing/packages.ts";
import { fakeSandbox } from "./testing/sandbox.ts";

const MODEL = new TextEncoder().encode("model weights");
const MODEL_URL = "https://models.example.com/w.bin";

/** Every client a test makes, closed at the end so no port keeps Node running. */
const made: SheetModelClient[] = [];
after(() => {
  for (const c of made) closeClient(c);
});

class MemoryFiles implements PluginFiles {
  readonly map = new Map<string, Uint8Array>();
  async getFile(digest: string) {
    return this.map.get(digest) ?? null;
  }
  async putFile(digest: string, data: Uint8Array) {
    this.map.set(digest, data);
  }
}

/** A fetch that serves `body` for any URL, and records its calls. */
function fakeFetch(body: Uint8Array) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(new Uint8Array(body));
  };
  return { fetch, calls };
}

async function verified(card: ModelCard, withFile: boolean) {
  const files = withFile ? [{ url: MODEL_URL, size: BigInt(MODEL.length), digest: await digestUrn(MODEL) }] : [];
  const sized = create(ModelCardSchema, { ...card, downloadBytes: BigInt(withFile ? MODEL.length : 0) });
  return verifyPackage(await rawPackage({ card: sized, key: testKey(), files }));
}

const scoreRequest = () => create(ScoreRequestSchema, { sheet: sheetRecord("hello", PRESETS.terminal) });

async function drain(stream: AsyncIterable<PrepareResponse>): Promise<PrepareResponse[]> {
  const out: PrepareResponse[] = [];
  for await (const item of stream) out.push(item);
  return out;
}

function client(
  pkg: Awaited<ReturnType<typeof verified>>,
  options: {
    files?: MemoryFiles;
    body?: Uint8Array;
    credentials?: Record<string, string>;
    sandbox?: ReturnType<typeof fakeSandbox>;
    works?: boolean;
  } = {},
): {
  client: SheetModelClient;
  files: MemoryFiles;
  sandbox: ReturnType<typeof fakeSandbox>;
  fetch: ReturnType<typeof fakeFetch>;
} {
  const files = options.files ?? new MemoryFiles();
  const sandbox = options.sandbox ?? fakeSandbox(pkg.card);
  const fetch = fakeFetch(options.body ?? MODEL);
  const credentials = options.credentials ?? {};
  const made1 = installedClient({
    pkg,
    files,
    context: { credential: (kind) => credentials[kind] ?? null },
    fetch: fetch.fetch,
    open: sandbox.open,
    sandboxWorks: async () => options.works ?? true,
  });
  made.push(made1);
  return {
    client: made1,
    files,
    sandbox,
    fetch,
  };
}

test("prepare downloads, checks, and stores a file; then status is ready", async () => {
  const pkg = await verified(overlayCard(), true);
  const { client: c, files, fetch } = client(pkg);
  assert.equal((await c.status(create(StatusRequestSchema))).ready, false);
  const events = await drain(c.prepare(create(PrepareRequestSchema)));
  assert.equal(events.at(-1)?.ready, true);
  assert.equal(events.at(-1)?.loadedBytes, BigInt(MODEL.length));
  assert.deepEqual(files.map.get(await digestUrn(MODEL)), MODEL);
  assert.equal(fetch.calls[0]?.url, MODEL_URL);
  assert.equal(fetch.calls[0]?.init?.credentials, "omit");
  assert.equal(fetch.calls[0]?.init?.referrerPolicy, "no-referrer");
  assert.equal((await c.status(create(StatusRequestSchema))).ready, true);
});

test("a file whose digest doesn't match is discarded, and nothing is kept", async () => {
  const pkg = await verified(overlayCard(), true);
  const tampered = MODEL.slice();
  tampered[0] = (tampered[0] ?? 0) ^ 1;
  const { client: c, files } = client(pkg, { body: tampered });
  await assert.rejects(drain(c.prepare(create(PrepareRequestSchema))), (e: unknown) =>
    isModelError(e, ErrorCode.INVALID_RESULT),
  );
  assert.equal(files.map.size, 0);
});

test("a file larger than its manifest says is discarded, and nothing is kept", async () => {
  const pkg = await verified(overlayCard(), true);
  const { client: c, files } = client(pkg, { body: new Uint8Array(MODEL.length + 10) });
  await assert.rejects(drain(c.prepare(create(PrepareRequestSchema))), /larger than its manifest says/);
  assert.equal(files.map.size, 0);
});

test("the start message carries the stored files and only the credentials the card declares", async () => {
  const pkg = await verified(penCard({ operations: [2, 3] }), true);
  const files = new MemoryFiles();
  await files.putFile(await digestUrn(MODEL), MODEL);
  const sandbox = fakeSandbox(pkg.card, () => ({ score: () => ({}) }));
  const { client: c } = client(pkg, { files, sandbox, credentials: { "api-key": "k-1", token: "secret" } });
  await c.score(scoreRequest());
  const runtime = sandbox.opened[0]?.runtime;
  assert.ok(runtime);
  assert.equal(runtime.credential("api-key"), "k-1");
  assert.equal(runtime.credential("token"), null);
  assert.deepEqual(runtime.file(MODEL_URL), MODEL);
  assert.deepEqual(sandbox.opened[0]?.options.network, { host: "api.example.com" });
});

test("an on-device plugin's sandbox gets no network", async () => {
  const pkg = await verified(overlayCard(), false);
  const sandbox = fakeSandbox(pkg.card, () => ({ score: () => ({}) }));
  const { client: c } = client(pkg, { sandbox });
  await c.score(scoreRequest());
  assert.equal(sandbox.opened[0]?.options.network, "none");
  assert.deepEqual(sandbox.opened[0]?.options.code, pkg.code);
});

test("changing a declared credential restarts the sandbox; the next call starts with the new value", async () => {
  const pkg = await verified(penCard({ operations: [2, 3] }), false);
  const credentials: Record<string, string> = { "api-key": "old" };
  const sandbox = fakeSandbox(pkg.card, () => ({ score: () => ({}) }));
  const c = installedClient({
    pkg,
    files: new MemoryFiles(),
    context: { credential: (kind) => credentials[kind] ?? null },
    fetch: fakeFetch(MODEL).fetch,
    open: sandbox.open,
    sandboxWorks: async () => true,
  });
  made.push(c);
  await c.score(scoreRequest());
  await c.score(scoreRequest());
  assert.equal(sandbox.opened.length, 1, "the same credentials reuse the sandbox");
  credentials["api-key"] = "new";
  await c.score(scoreRequest());
  assert.equal(sandbox.opened.length, 2);
  assert.equal(sandbox.opened[0]?.closed, true);
  assert.equal(sandbox.opened[1]?.runtime?.credential("api-key"), "new");
});

test("no plugin starts when the browser fails the self-test", async () => {
  const pkg = await verified(overlayCard(), false);
  const { client: c, sandbox } = client(pkg, { works: false });
  await assert.rejects(
    c.score(scoreRequest()),
    (e: unknown) => isModelError(e, ErrorCode.UNAVAILABLE) && e.message === NO_SANDBOX,
  );
  assert.equal(sandbox.opened.length, 0);
});

test("a call before the files are downloaded is refused, without starting the sandbox", async () => {
  const pkg = await verified(overlayCard(), true);
  const { client: c, sandbox } = client(pkg);
  await assert.rejects(c.score(scoreRequest()), (e: unknown) => isModelError(e, ErrorCode.NOT_READY));
  assert.equal(sandbox.opened.length, 0);
});

test("a plugin that describes itself as another plugin is refused, and its sandbox closed", async () => {
  const pkg = await verified(overlayCard(), false);
  const sandbox = fakeSandbox(overlayCard({ id: "example.other" }));
  const { client: c } = client(pkg, { sandbox });
  await assert.rejects(c.score(scoreRequest()), (e: unknown) => isModelError(e, ErrorCode.INVALID_CARD));
  assert.equal(sandbox.opened[0]?.closed, true);
});

test("describe answers from the verified card without starting the sandbox", async () => {
  const pkg = await verified(overlayCard(), false);
  const { client: c, sandbox } = client(pkg);
  assert.equal((await c.describe(create(ScoreRequestSchema) as never)).card?.id, "example.word-length");
  assert.equal(sandbox.opened.length, 0);
});
