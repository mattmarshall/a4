import { after, test } from "node:test";
import assert from "node:assert/strict";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { ModelCardSchema } from "../gen/a4/v1/model_pb.js";
import { InstalledPluginSchema, PluginPackageSchema } from "../gen/a4/v1/plugin_pb.js";
import { PRESETS } from "../page/index.ts";
import { MemoryPluginStore } from "../platform/plugin-store.ts";
import { handlers as wordLength } from "../../examples/plugins/word-length/plugin.ts";
import { ErrorCode, ModelError } from "./errors.ts";
import { FetchPackageError, fetchPackage } from "./installed.ts";
import { BUNDLED_CARDS } from "./manifest.ts";
import { cardFromJson, PackageError, packPackage } from "./package.ts";
import { pluginIdOf } from "./plugin-id.ts";
import { PluginRegistry } from "./registry.ts";
import { SAMPLE_CODE, testKey } from "./testing/packages.ts";
import { fakeSandbox } from "./testing/sandbox.ts";
import wordLengthCard from "../../examples/plugins/word-length/card.json" with { type: "json" };

const card = cardFromJson(JSON.stringify(wordLengthCard));

/** A fetch that records each URL, and serves `body` or throws. */
function recordingFetch(body: Uint8Array | (() => never) = new Uint8Array()) {
  const calls: string[] = [];
  const fetch: typeof globalThis.fetch = async (input) => {
    calls.push(String(input));
    if (typeof body === "function") body();
    return new Response(new Uint8Array(body as Uint8Array));
  };
  return { fetch, calls };
}

async function wordLengthPackage(version = "1.0.0", key = testKey()) {
  return packPackage({
    card: create(ModelCardSchema, { ...card, version }),
    publisherName: "A4 examples",
    publicKey: key.publicKey,
    code: SAMPLE_CODE,
    files: [],
    signedAt: new Date("2026-11-25T12:00:00Z"),
    sign: key.sign,
  });
}

const registries: PluginRegistry[] = [];
after(() => {
  for (const r of registries) for (const p of r.installed()) r.host.unregister(pluginIdOf(p.pkg.card));
});

function registry(store = new MemoryPluginStore(), fetch = recordingFetch()) {
  const sandbox = fakeSandbox(card, wordLength);
  const r = new PluginRegistry({ store, fetch: fetch.fetch, open: sandbox.open, sandboxWorks: async () => true });
  registries.push(r);
  return { registry: r, store, sandbox, fetch };
}

test("bundled plugins register first and unchanged; installed ones follow", async () => {
  const { registry: first, store } = registry();
  await first.install(await first.inspect(await wordLengthPackage()));
  const { registry: reloaded } = registry(store);
  await reloaded.load();
  const ids = reloaded.host.list().map((c) => c.id);
  assert.deepEqual(
    ids.slice(0, BUNDLED_CARDS.length),
    BUNDLED_CARDS.map((c) => c.id),
  );
  assert.deepEqual(ids.slice(BUNDLED_CARDS.length), ["example.word-length"]);
  assert.equal(reloaded.installed()[0]?.pkg.card.name, "Word length");
});

test("after a reload, an installed overlay scores through the host, the kit, and its own handlers", async () => {
  const { registry: first, store } = registry();
  await first.install(await first.inspect(await wordLengthPackage()));
  const { registry: reloaded, sandbox } = registry(store);
  await reloaded.load();
  const result = await reloaded.host.score(pluginIdOf(card), "Deploy notes", PRESETS.terminal);
  assert.equal(result.planes[0]?.name, "Word length");
  assert.equal(result.planes[0]?.pluginName, "Word length");
  assert.ok(Math.abs((result.planes[0]?.values[0] ?? 0) - 0.5) < 1e-6);
  assert.equal(sandbox.opened[0]?.options.network, "none");
});

test("a damaged plugin isn't registered, and removing it clears it", async () => {
  const { registry: first, store } = registry();
  await first.install(await first.inspect(await wordLengthPackage()));
  const record = fromBinary(InstalledPluginSchema, store.plugins.get("example.word-length") ?? new Uint8Array());
  const pkg = fromBinary(PluginPackageSchema, record.package);
  pkg.code = new TextEncoder().encode("// changed");
  record.package = toBinary(PluginPackageSchema, pkg);
  store.plugins.set("example.word-length", toBinary(InstalledPluginSchema, record));
  const { registry: reloaded } = registry(store);
  await reloaded.load();
  assert.deepEqual(reloaded.installed(), []);
  assert.equal(reloaded.damaged()[0]?.id, "example.word-length");
  assert.equal(
    reloaded.host.list().some((c) => c.id === "example.word-length"),
    false,
  );
  await reloaded.remove("example.word-length");
  assert.deepEqual(reloaded.damaged(), []);
  assert.equal(store.plugins.size, 0);
});

test("removing an installed plugin unregisters it", async () => {
  const { registry: r } = registry();
  await r.install(await r.inspect(await wordLengthPackage()));
  await r.remove("example.word-length");
  await assert.rejects(
    r.host.score(pluginIdOf(card), "x", PRESETS.terminal),
    (e: unknown) => e instanceof ModelError && e.code === ErrorCode.NOT_FOUND,
  );
});

test("an update replaces the registered plugin", async () => {
  const key = testKey();
  const { registry: r } = registry();
  await r.install(await r.inspect(await wordLengthPackage("1.0.0", key)));
  const update = await r.inspect(await wordLengthPackage("1.1.0", key));
  assert.equal(update.kind.is, "update");
  await r.install(update);
  assert.equal(r.host.card(pluginIdOf(card)).version, "1.1.0");
  assert.equal(r.installed().length, 1);
});

test("loading the store makes no request, even for a plugin installed from a URL", async () => {
  const pkg = await wordLengthPackage();
  const fetch = recordingFetch(pkg);
  const { registry: first, store } = registry(new MemoryPluginStore(), fetch);
  await first.install(await first.inspectUrl("https://plugins.example.com/word-length.a4plugin"));
  assert.deepEqual(fetch.calls, ["https://plugins.example.com/word-length.a4plugin"]);
  const reloadFetch = recordingFetch();
  const { registry: reloaded } = registry(store, reloadFetch);
  await reloaded.load();
  assert.deepEqual(reloadFetch.calls, []);
  assert.equal(reloaded.installed()[0]?.sourceUrl, "https://plugins.example.com/word-length.a4plugin");
});

test("check for update fetches the plugin's URL only when asked", async () => {
  const key = testKey();
  const fetch = recordingFetch(await wordLengthPackage("1.0.0", key));
  const { registry: r } = registry(new MemoryPluginStore(), fetch);
  await r.install(await r.inspectUrl("https://plugins.example.com/w.a4plugin"));
  assert.equal(fetch.calls.length, 1);
  await assert.rejects(r.checkForUpdate("example.word-length"), /already installed/);
  assert.equal(fetch.calls.length, 2);
});

test("an HTTP URL is refused without a request", async () => {
  const fetch = recordingFetch();
  await assert.rejects(fetchPackage(fetch.fetch, "http://example.com/word-length.a4plugin"), (e: unknown) => {
    return e instanceof FetchPackageError && /must use HTTPS/.test(e.message);
  });
  assert.deepEqual(fetch.calls, []);
});

test("a host that blocks cross-origin requests gets a suggestion to install from a file", async () => {
  const fetch = recordingFetch(() => {
    throw new TypeError("Failed to fetch");
  });
  await assert.rejects(fetchPackage(fetch.fetch, "https://example.com/p.a4plugin"), /install it from the file/);
});

test("an oversized body is cut off at 16 MiB, without reading the rest", async () => {
  let pulled = 0;
  const chunk = new Uint8Array(1024 * 1024);
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled++;
      if (pulled > 40) controller.close();
      else controller.enqueue(chunk);
    },
  });
  const fetch: typeof globalThis.fetch = async () => new Response(body);
  await assert.rejects(
    fetchPackage(fetch, "https://example.com/big.a4plugin"),
    (e: unknown) => e instanceof PackageError && e.problem === "too-large",
  );
  assert.ok(pulled <= 18, `read ${pulled} MiB`);
});
