import { test } from "node:test";
import assert from "node:assert/strict";
import { settle } from "../persist/autosave/testing/fake-scheduler.ts";
import { MemoryHandleStore } from "./handle-store.ts";
import { MemoryKeyValue } from "./key-value.ts";
import { noLocks } from "./locks.ts";
import { randomId } from "./random-id.ts";
import { ChannelHub, fakePlatform, FakeTabs } from "./testing/fakes.ts";

test("random ids are 16 hex characters, and differ", () => {
  const a = randomId();
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.notEqual(a, randomId());
});

test("a channel reaches the other tabs, not its own", async () => {
  const hub = new ChannelHub();
  const a = hub.open("a4-pages");
  const b = hub.open("a4-pages");
  const other = hub.open("other");
  const got: string[] = [];
  a.subscribe(() => got.push("a"));
  b.subscribe((data) => got.push(`b:${(data as Uint8Array).join(",")}`));
  other.subscribe(() => got.push("other"));
  a.post(new Uint8Array([1, 2]));
  await settle();
  assert.deepEqual(got, ["b:1,2"]);
  b.close();
  a.post(new Uint8Array([3]));
  await settle();
  assert.deepEqual(got, ["b:1,2"], "a closed channel hears nothing");
});

test("fake tabs are live until they close", async () => {
  const tabs = new FakeTabs();
  tabs.hold("one");
  tabs.hold("two");
  tabs.close("one");
  assert.deepEqual([...(await tabs.live())], ["two"]);
});

test("a fake platform's clock follows its scheduler", async () => {
  const platform = fakePlatform();
  const start = platform.clock.now();
  await platform.scheduler.advance(1_500);
  assert.equal(platform.clock.now() - start, 1_500);
  assert.notEqual(platform.randomId(), platform.randomId());
});

test("memory adapters store what they're given", async () => {
  const kv = new MemoryKeyValue();
  kv.set("a4:x", "1");
  assert.deepEqual(kv.keys(), ["a4:x"]);
  const handles = new MemoryHandleStore();
  assert.equal(await handles.get("missing"), null);
  assert.equal(await noLocks.request("a", async () => 7), 7);
});
