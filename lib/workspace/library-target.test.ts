import assert from "node:assert/strict";
import { test } from "node:test";
import { SETTINGS } from "../persist/settings.ts";
import { servedConnection } from "../persist/store/served.ts";
import { BROWSER, channelName, journalPrefix, type LibraryTarget, openSettings, sameTarget } from "./library-target.ts";

const TOKEN = "A".repeat(43);
const connection = servedConnection("127.0.0.1:4320", TOKEN);
if (!connection) throw new Error("the test connection should parse");
const served: LibraryTarget = { kind: "served", connection };

test("this browser's library keeps the keys and channel it had before served libraries", () => {
  // Drafts and tab messages from before the served library must still be found.
  assert.equal(journalPrefix(BROWSER), "a4:");
  assert.equal(channelName(BROWSER), "a4-pages");
  assert.deepEqual(openSettings(BROWSER), { a: SETTINGS.openA, b: SETTINGS.openB });
  assert.deepEqual(openSettings(null), { a: SETTINGS.openA, b: SETTINGS.openB });
});

test("a served library keeps its drafts, messages, and open pages apart, by address", () => {
  assert.equal(journalPrefix(served), "a4:served:127.0.0.1:4320:");
  assert.equal(channelName(served), "a4-pages:127.0.0.1:4320");
  assert.deepEqual(openSettings(served), { a: SETTINGS.servedOpenA, b: SETTINGS.servedOpenB });
});

test("targets are the same library only for the same kind and connection", () => {
  const other = servedConnection("127.0.0.1:4321", TOKEN);
  assert.ok(other);
  assert.ok(sameTarget(BROWSER, { kind: "browser" }));
  assert.ok(sameTarget(served, { kind: "served", connection: { ...connection } }));
  assert.ok(!sameTarget(null, BROWSER));
  assert.ok(!sameTarget(BROWSER, served));
  assert.ok(!sameTarget(served, { kind: "served", connection: other }));
});
