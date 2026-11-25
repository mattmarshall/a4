import { test } from "node:test";
import assert from "node:assert/strict";
import { KNOWN_PUBLISHERS, knownPublisher } from "./publishers.ts";
import { testKey } from "./testing/packages.ts";

const a = testKey();
const b = testKey();
const LIST = [{ name: "Example Labs", publicKey: Buffer.from(a.publicKey).toString("base64") }];

test("A4's list ships empty", () => {
  assert.deepEqual(KNOWN_PUBLISHERS, []);
  assert.equal(knownPublisher(a.publicKey), null);
});

test("a listed key gives the list's name", () => {
  assert.equal(knownPublisher(a.publicKey, LIST)?.name, "Example Labs");
});

test("another key is unknown, whatever name its package gives", () => {
  assert.equal(knownPublisher(b.publicKey, LIST), null);
});
