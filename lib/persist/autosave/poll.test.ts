import { test } from "node:test";
import assert from "node:assert/strict";
import { PollLoop } from "./poll.ts";
import { FakeScheduler } from "./testing/fake-scheduler.ts";

function loop(options: { visible?: () => boolean; active?: () => boolean; pass?: () => Promise<void> } = {}) {
  const scheduler = new FakeScheduler();
  let passes = 0;
  const poller = new PollLoop({
    scheduler,
    intervalMs: 1000,
    isVisible: options.visible ?? (() => true),
    poll: async () => {
      passes++;
      await options.pass?.();
    },
    ...(options.active ? { active: options.active } : {}),
  });
  return { scheduler, poller, passes: () => passes };
}

test("it polls once each interval while visible", async () => {
  const { scheduler, poller, passes } = loop();
  poller.start();
  await scheduler.advance(999);
  assert.equal(passes(), 0);
  await scheduler.advance(1);
  assert.equal(passes(), 1);
  await scheduler.advance(3000);
  assert.equal(passes(), 4);
  poller.stop();
});

test("it skips passes while hidden, and polls again once visible", async () => {
  let visible = false;
  const { scheduler, poller, passes } = loop({ visible: () => visible });
  poller.start();
  await scheduler.advance(3000);
  assert.equal(passes(), 0);
  visible = true;
  await scheduler.advance(1000);
  assert.equal(passes(), 1);
  poller.stop();
});

test("it never starts a pass while one is running", async () => {
  let finish = () => {};
  let blocked = false;
  const { poller, passes } = loop({
    // Only the first pass waits to be finished.
    pass: () =>
      blocked
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            blocked = true;
            finish = resolve;
          }),
  });
  const first = poller.tick();
  await poller.tick();
  assert.equal(passes(), 1, "the second tick was skipped");
  finish();
  await first;
  await poller.tick();
  assert.equal(passes(), 2);
  poller.stop();
});

test("it sets no timer while there's nothing to poll", async () => {
  let watching = false;
  const { scheduler, poller, passes } = loop({ active: () => watching });
  poller.start();
  await scheduler.advance(5000);
  assert.equal(passes(), 0);
  watching = true;
  poller.start();
  await scheduler.advance(1000);
  assert.equal(passes(), 1);
  watching = false;
  await scheduler.advance(5000);
  assert.equal(passes(), 1, "after the last watched thing goes, the loop idles");
  poller.stop();
});

test("after stop, no pass runs and no timer is set", async () => {
  const { scheduler, poller, passes } = loop();
  poller.start();
  poller.stop();
  poller.start();
  await scheduler.advance(5000);
  await poller.tick();
  assert.equal(passes(), 0);
  assert.equal(poller.stopped, true);
});
