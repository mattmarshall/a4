import assert from "node:assert/strict";
import { test } from "node:test";
import { SETTINGS } from "../persist/settings.ts";
import { servedConnection } from "../persist/store/served.ts";
import { libraryIdOf } from "../persist/store/testing/library-id.ts";
import {
  addressKeys,
  BROWSER,
  channelName,
  isShown,
  journalPrefix,
  type LibraryTarget,
  openSettings,
} from "./library-target.ts";

const TOKEN = "A".repeat(43);
const LIBRARY = libraryIdOf("AbCdEfGhIjKlMnOpQrSt_-");
const OTHER_LIBRARY = libraryIdOf("ZyXwVuTsRqPoNmLkJiHg_-");
const connection = servedConnection("127.0.0.1:4320", TOKEN);
if (!connection) throw new Error("the test connection should parse");
const served: LibraryTarget = { kind: "served", connection, library: LIBRARY };
const otherFolder: LibraryTarget = { kind: "served", connection, library: OTHER_LIBRARY };

test("this browser's library keeps the keys and channel it had before served libraries", () => {
  // Drafts and tab messages from before the served library must still be found.
  assert.equal(journalPrefix(BROWSER), "a4:");
  assert.equal(channelName(BROWSER), "a4-pages");
  assert.deepEqual(openSettings(BROWSER), { a: SETTINGS.openA, b: SETTINGS.openB });
  assert.deepEqual(openSettings(null), { a: SETTINGS.openA, b: SETTINGS.openB });
});

test("a served library keeps its drafts, messages, and open pages by its id, not its address", () => {
  assert.equal(journalPrefix(served), `a4:served:${LIBRARY}:`);
  assert.equal(channelName(served), `a4-pages:served:${LIBRARY}`);
  assert.equal(openSettings(served).a.key, `served:${LIBRARY}:open:a`);
  assert.equal(openSettings(served).b.key, `served:${LIBRARY}:open:b`);
  // Another folder at the same address keeps its own.
  assert.notEqual(journalPrefix(otherFolder), journalPrefix(served));
  assert.notEqual(channelName(otherFolder), channelName(served));
  assert.notEqual(openSettings(otherFolder).a.key, openSettings(served).a.key);
});

test("what was kept by address names the old keys, for adopting once", () => {
  const kept = addressKeys("127.0.0.1:4320");
  assert.equal(kept.journalPrefix, "a4:served:127.0.0.1:4320:");
  assert.deepEqual(kept.open, { a: SETTINGS.servedOpenA, b: SETTINGS.servedOpenB });
});

test("a choice is already shown only for the same kind and connection", () => {
  const other = servedConnection("127.0.0.1:4321", TOKEN);
  assert.ok(other);
  assert.ok(isShown(BROWSER, { kind: "browser" }));
  assert.ok(isShown(served, { kind: "served", connection: { ...connection } }));
  assert.ok(!isShown(null, BROWSER));
  assert.ok(!isShown(BROWSER, { kind: "served", connection }));
  assert.ok(!isShown(served, BROWSER));
  assert.ok(!isShown(served, { kind: "served", connection: other }));
});
