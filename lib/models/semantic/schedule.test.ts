import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeScheduler } from "../../persist/autosave/testing/fake-scheduler.ts";
import { ScoreSchedule } from "./schedule.ts";

function setup(delayMs = 1500) {
  const scheduler = new FakeScheduler();
  const calls: string[] = [];
  const results: string[] = [];
  const pending: (() => void)[] = [];
  const schedule = new ScoreSchedule<"a" | "b", string>({
    scheduler,
    delayMs,
    score: (key, text) => {
      calls.push(`${key}:${text}`);
      return new Promise((resolve) => pending.push(() => resolve(`scored ${text}`)));
    },
    onResult: (key, result) => results.push(`${key}:${result}`),
  });
  const finishAll = async () => {
    while (pending.length) pending.shift()!();
    await scheduler.advance(0);
  };
  return { scheduler, schedule, calls, results, finishAll };
}

test("turning the lens on scores once, even when the effect reports the same text", async () => {
  const { scheduler, schedule, calls, finishAll } = setup();
  schedule.now("a", "page", "terminal"); // the lens is turned on
  schedule.changed("a", "page", "terminal"); // the effect runs with the same text
  await scheduler.advance(3000);
  await finishAll();
  schedule.changed("a", "page", "terminal"); // re-render after the result
  await scheduler.advance(3000);
  assert.deepEqual(calls, ["a:page"]);
});

test("a pause in typing scores once; a result for older text is dropped", async () => {
  const { scheduler, schedule, calls, results, finishAll } = setup();
  schedule.changed("a", "v1", "terminal");
  await scheduler.advance(1500);
  assert.deepEqual(calls, ["a:v1"]);
  schedule.changed("a", "v2", "terminal"); // typing again before v1's result arrives
  await finishAll(); // v1 resolves: stale, dropped
  assert.deepEqual(results, []);
  await scheduler.advance(1499);
  assert.deepEqual(calls, ["a:v1"]);
  await scheduler.advance(1);
  assert.deepEqual(calls, ["a:v1", "a:v2"]);
  await finishAll();
  assert.deepEqual(results, ["a:scored v2"]);
});

test("slots are independent, and stop drops late results", async () => {
  const { scheduler, schedule, calls, results, finishAll } = setup();
  schedule.now("a", "A", "terminal");
  schedule.now("b", "B", "terminal");
  schedule.stop();
  await finishAll();
  await scheduler.advance(3000);
  assert.deepEqual(calls, ["a:A", "b:B"]);
  assert.deepEqual(results, []);
});

test("a changed preset rescores the same text", async () => {
  const { scheduler, schedule, calls, finishAll } = setup();
  schedule.now("a", "page", "terminal");
  await finishAll();
  schedule.changed("a", "page", "dense");
  await scheduler.advance(1500);
  assert.deepEqual(calls, ["a:page", "a:page"]);
});
