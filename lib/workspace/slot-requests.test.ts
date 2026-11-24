import { test } from "node:test";
import assert from "node:assert/strict";
import { SlotRequests } from "./slot-requests.ts";

test("the last request for a slot wins; other slots are independent", () => {
  const requests = new SlotRequests<"a" | "b">();
  const first = requests.begin("b");
  const a = requests.begin("a");
  assert.ok(first.current());
  const second = requests.begin("b");
  assert.ok(!first.current());
  assert.ok(second.current());
  assert.ok(a.current());
});

test("overlapping async opens: only the latest one keeps its result", async () => {
  const requests = new SlotRequests<"b">();
  const kept: string[] = [];
  const dropped: string[] = [];
  async function open(name: string, delayMs: number) {
    const ticket = requests.begin("b");
    await new Promise((r) => setTimeout(r, delayMs));
    (ticket.current() ? kept : dropped).push(name);
  }
  // The slower, earlier request resumes last but is stale.
  await Promise.all([open("ensure-slot-b", 20), open("fit-result", 5)]);
  assert.deepEqual(kept, ["fit-result"]);
  assert.deepEqual(dropped, ["ensure-slot-b"]);
});
