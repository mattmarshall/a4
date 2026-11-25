import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryPluginStore } from "../lib/platform/plugin-store.ts";
import { inspect, install } from "../lib/models/installed.ts";
import { overlayCard, penCard, rawPackage, testKey } from "../lib/models/testing/packages.ts";
import { FIT_TO_PAGE } from "../lib/models/index.ts";
import { formatBytes, installDialog, penSuffix } from "./plugin-copy.ts";

const text = (copy: ReturnType<typeof installDialog>) =>
  [copy.title, ...copy.rows.map((r) => `${r.label}: ${r.value}`), ...copy.changes].join("\n");

test("the install dialog for a pen that sends text away names the host, consent, credentials, and publisher", async () => {
  const store = new MemoryPluginStore();
  const inspection = await inspect(store, await rawPackage({ card: penCard(), key: testKey() }), "");
  const copy = installDialog(inspection);
  assert.equal(copy.title, "Install Remote pen 1.0.0?");
  assert.equal(copy.confirm, "Install");
  const all = text(copy);
  assert.match(all, /Does: A pen: it writes a new page from yours, and never changes yours/);
  assert.match(all, /Page text: Sends the page to api\.example\.com, only after you confirm each request/);
  assert.match(all, /Credentials: Asks for: API key/);
  assert.match(all, /Publisher: Unknown publisher \(calls itself “Example Labs”\)/);
  assert.match(all, /Fingerprint: [0-9a-f]{4}( [0-9a-f]{4}){7}/);
  assert.match(all, /From: A file you chose/);
  assert.deepEqual(copy.changes, []);
});

test("the update dialog says when an update starts sending text away, with both versions", async () => {
  const store = new MemoryPluginStore();
  const key = testKey();
  await install(
    store,
    await inspect(store, await rawPackage({ card: overlayCard(), key }), "https://p.example.com/w"),
    new Date(),
  );
  const v2 = overlayCard({
    version: "2.0.0",
    placement: { case: "remote", value: { destinationHost: "api.example.com" } },
  });
  const copy = installDialog(await inspect(store, await rawPackage({ card: v2, key }), ""));
  assert.equal(copy.title, "Update Word length from 1.0.0 to 2.0.0?");
  assert.equal(copy.confirm, "Update");
  assert.deepEqual(copy.changes, [
    "It will now send page text to api.example.com, only after you confirm each request.",
  ]);
  assert.match(text(copy), /From: https:\/\/p\.example\.com\/w/);
});

test("a pen's result is named after the source and the pen; Fit to page keeps its own suffix", () => {
  assert.equal(penSuffix(FIT_TO_PAGE.card), " (fit)");
  assert.equal(penSuffix(penCard({ name: "Hard wrap" })), " (Hard wrap)");
});

test("sizes read in KB and decimal MB", () => {
  assert.equal(formatBytes(12_000), "12 KB");
  assert.equal(formatBytes(38_000_000), "38.0 MB");
});
