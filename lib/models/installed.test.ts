import { test } from "node:test";
import assert from "node:assert/strict";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { type ModelCard, ModelCardSchema } from "../gen/a4/v1/model_pb.js";
import { InstalledPluginSchema, PluginPackageSchema } from "../gen/a4/v1/plugin_pb.js";
import { MemoryPluginStore } from "../platform/plugin-store.ts";
import { InstallError, type InstallProblem, inspect, install, loadInstalled, loadOne, remove } from "./installed.ts";
import { digestUrn, PackageError } from "./package.ts";
import { overlayCard, penCard, rawPackage, type TestKey, testKey } from "./testing/packages.ts";

const NOW = new Date("2026-11-25T12:00:00Z");
const fileA = new TextEncoder().encode("file A");
const fileB = new TextEncoder().encode("file B");

async function withFiles(card: ModelCard, key: TestKey, files: Uint8Array[]): Promise<Uint8Array> {
  const listed = await Promise.all(
    files.map(async (data, i) => ({
      url: `https://models.example.com/${i}.bin`,
      size: BigInt(data.length),
      digest: await digestUrn(data),
    })),
  );
  const total = files.reduce((sum, f) => sum + f.length, 0);
  return rawPackage({ card: create(ModelCardSchema, { ...card, downloadBytes: BigInt(total) }), key, files: listed });
}

async function installed(store: MemoryPluginStore, bytes: Uint8Array, sourceUrl = "") {
  return install(store, await inspect(store, bytes, sourceUrl), NOW);
}

async function refusedInstall(promise: Promise<unknown>, problem: InstallProblem, message?: RegExp) {
  await assert.rejects(promise, (e: unknown) => {
    assert.ok(e instanceof InstallError, String(e));
    assert.equal(e.problem, problem);
    if (message) assert.match(e.message, message);
    return true;
  });
}

test("a valid package inspects as a new install, and installing stores it under its id", async () => {
  const store = new MemoryPluginStore();
  const key = testKey();
  const bytes = await rawPackage({ card: overlayCard(), key });
  const inspection = await inspect(store, bytes, "https://plugins.example.com/w.a4plugin");
  assert.deepEqual(inspection.kind, { is: "install" });
  assert.equal(inspection.known, null);
  assert.equal(store.plugins.size, 0, "inspecting stores nothing");
  await install(store, inspection, NOW);
  const { installed: list, damaged } = await loadInstalled(store);
  assert.deepEqual(damaged, []);
  assert.equal(list[0]?.id, "example.word-length");
  assert.equal(list[0]?.sourceUrl, "https://plugins.example.com/w.a4plugin");
  assert.deepEqual(list[0]?.installedAt, NOW);
});

test("a tampered package is refused at inspection, and nothing is stored", async () => {
  const store = new MemoryPluginStore();
  const bytes = await rawPackage({
    card: overlayCard(),
    key: testKey(),
    tamperManifest: (m) => {
      const last = m.length - 1;
      m[last] = (m[last] ?? 0) ^ 1;
    },
  });
  await assert.rejects(
    inspect(store, bytes, ""),
    (e: unknown) => e instanceof PackageError && e.problem === "signature",
  );
  assert.equal(store.plugins.size, 0);
});

test("the same id from another key is refused while the plugin is installed", async () => {
  const store = new MemoryPluginStore();
  await installed(store, await rawPackage({ card: overlayCard(), key: testKey() }));
  const other = await rawPackage({ card: overlayCard({ version: "2.0.0" }), key: testKey() });
  await refusedInstall(inspect(store, other, ""), "other-key", /Another publisher’s plugin already uses the id/);
});

test("a bundled plugin's id is refused", async () => {
  const store = new MemoryPluginStore();
  const bytes = await rawPackage({ card: overlayCard({ id: "semantic-repetition" }), key: testKey() });
  await refusedInstall(inspect(store, bytes, ""), "bundled-id", /belongs to a built-in plugin/);
});

test("an older version is refused, and the same version is already installed", async () => {
  const store = new MemoryPluginStore();
  const key = testKey();
  const v120 = await rawPackage({ card: overlayCard({ version: "1.2.0" }), key });
  await installed(store, v120);
  await refusedInstall(
    inspect(store, await rawPackage({ card: overlayCard({ version: "1.1.0" }), key }), ""),
    "older",
    /1\.2\.0 .* is installed, which is newer/,
  );
  await refusedInstall(inspect(store, v120, ""), "already-installed");
  const rebuilt = await rawPackage({ card: overlayCard({ version: "1.2.0", description: "changed" }), key });
  await refusedInstall(inspect(store, rebuilt, ""), "same-version", /needs a newer version/);
});

test("an update that starts sending text away says so, with both versions", async () => {
  const store = new MemoryPluginStore();
  const key = testKey();
  await installed(store, await rawPackage({ card: overlayCard({ version: "1.0.0" }), key }), "https://p.example.com/x");
  const v2 = overlayCard({
    version: "2.0.0",
    placement: { case: "remote", value: { destinationHost: "api.example.com" } },
    credentials: [{ kind: "api-key", label: "API key" }],
  });
  const inspection = await inspect(store, await rawPackage({ card: v2, key }), "");
  assert.deepEqual(inspection.kind, { is: "update", previousVersion: "1.0.0" });
  assert.deepEqual(inspection.changes.destination, { before: null, after: "api.example.com" });
  assert.deepEqual(inspection.changes.credentials, { before: [], after: ["API key"] });
  assert.equal(inspection.changes.downloadBytes, undefined);
  assert.equal(inspection.sourceUrl, "https://p.example.com/x", "an update keeps the URL it was installed from");
});

test("stored code that changed is damaged and not loaded", async () => {
  const store = new MemoryPluginStore();
  await installed(store, await rawPackage({ card: overlayCard(), key: testKey() }));
  const record = fromBinary(InstalledPluginSchema, store.plugins.get("example.word-length") ?? new Uint8Array());
  const pkg = fromBinary(PluginPackageSchema, record.package);
  pkg.code = new TextEncoder().encode("fetch('https://collector.example/');");
  record.package = toBinary(PluginPackageSchema, pkg);
  store.plugins.set("example.word-length", toBinary(InstalledPluginSchema, record));
  const { installed: list, damaged } = await loadInstalled(store);
  assert.deepEqual(list, []);
  assert.equal(damaged[0]?.id, "example.word-length");
  assert.match(damaged[0]?.reason ?? "", /doesn’t match its digest/);
});

test("removing deletes the record and its files, and keeps a file another plugin lists", async () => {
  const store = new MemoryPluginStore();
  const key = testKey();
  await installed(store, await withFiles(overlayCard(), key, [fileA, fileB]));
  await installed(store, await withFiles(penCard({ id: "example.other" }), key, [fileB]));
  for (const data of [fileA, fileB]) await store.putFile(await digestUrn(data), data);
  await remove(store, "example.word-length");
  assert.equal(await store.getRecord("example.word-length"), null);
  assert.equal(await store.getFile(await digestUrn(fileA)), null, "its own file is gone");
  assert.notEqual(await store.getFile(await digestUrn(fileB)), null, "the shared file stays");
  // With the pin gone, another key may now use the id.
  const again = await rawPackage({ card: overlayCard(), key: testKey() });
  assert.deepEqual((await inspect(store, again, "")).kind, { is: "install" });
});

test("an update drops the old version's files that the new one no longer lists", async () => {
  const store = new MemoryPluginStore();
  const key = testKey();
  await installed(store, await withFiles(overlayCard({ version: "1.0.0" }), key, [fileA]));
  await store.putFile(await digestUrn(fileA), fileA);
  await installed(store, await withFiles(overlayCard({ version: "1.1.0" }), key, [fileB]));
  assert.equal(await store.getFile(await digestUrn(fileA)), null);
});

test("loadOne reads one record again: absent, damaged, or installed", async () => {
  const store = new MemoryPluginStore();
  assert.deepEqual(await loadOne(store, "example.word-length"), { is: "absent" });
  await installed(store, await rawPackage({ card: overlayCard(), key: testKey() }));
  const loaded = await loadOne(store, "example.word-length");
  assert.equal(loaded.is, "installed");
  assert.equal(loaded.is === "installed" && loaded.plugin.pkg.card.version, "1.0.0");
  const record = store.plugins.get("example.word-length") ?? new Uint8Array();
  store.plugins.set("example.other", record);
  const misfiled = await loadOne(store, "example.other");
  assert.equal(misfiled.is, "damaged");
  assert.match(misfiled.is === "damaged" ? misfiled.damaged.reason : "", /stored as “example.other”/);
});
