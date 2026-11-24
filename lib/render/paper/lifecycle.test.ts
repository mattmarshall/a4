import { test } from "node:test";
import assert from "node:assert/strict";
import { RendererLifecycle, type RendererState } from "./lifecycle.ts";

class FakeRenderer {
  destroyed = false;
  readonly lost: Promise<unknown>;
  lose: () => void = () => {};
  constructor() {
    this.lost = new Promise((resolve) => {
      this.lose = () => resolve(undefined);
    });
  }
  destroy() {
    this.destroyed = true;
  }
}

/** A create() whose results the test settles by hand. */
function controlledCreate() {
  const pending: { resolve: (r: FakeRenderer) => void; reject: (e: unknown) => void }[] = [];
  const create = () =>
    new Promise<FakeRenderer>((resolve, reject) => {
      pending.push({ resolve, reject });
    });
  return { create, pending };
}

const tick = () => new Promise((r) => setImmediate(r));

function setup() {
  const { create, pending } = controlledCreate();
  const seen: RendererState<FakeRenderer>["kind"][] = [];
  const life = new RendererLifecycle(create, (s) => seen.push(s.kind));
  return { life, pending, seen };
}

test("ensure creates once; the renderer is ready when creation finishes", async () => {
  const { life, pending, seen } = setup();
  life.ensure();
  life.ensure();
  assert.equal(pending.length, 1, "a second ensure while creating does nothing");
  assert.equal(life.state.kind, "creating");
  const r = new FakeRenderer();
  pending[0]?.resolve(r);
  await tick();
  assert.equal(life.renderer, r);
  assert.deepEqual(seen, ["ready"]);
});

test("a creation that finishes after release is stale and destroyed", async () => {
  const { life, pending } = setup();
  life.ensure();
  life.release();
  life.ensure();
  assert.equal(pending.length, 2);
  const stale = new FakeRenderer();
  const fresh = new FakeRenderer();
  pending[1]?.resolve(fresh);
  pending[0]?.resolve(stale);
  await tick();
  assert.ok(stale.destroyed);
  assert.equal(life.renderer, fresh);
});

test("release destroys the ready renderer", async () => {
  const { life, pending } = setup();
  life.ensure();
  const r = new FakeRenderer();
  pending[0]?.resolve(r);
  await tick();
  life.release();
  assert.ok(r.destroyed);
  assert.equal(life.state.kind, "idle");
});

test("a failed creation is unavailable, with the reason kept", async () => {
  const { life, pending } = setup();
  life.ensure();
  pending[0]?.reject(new Error("This browser doesn’t provide WebGPU."));
  await tick();
  assert.deepEqual(life.state, { kind: "unavailable", reason: "This browser doesn’t provide WebGPU." });
  life.release();
  life.ensure();
  assert.equal(pending.length, 1, "unavailable stays unavailable");
});

test("a lost device recreates 3D once, then gives up", async () => {
  const { life, pending, seen } = setup();
  life.ensure();
  const first = new FakeRenderer();
  pending[0]?.resolve(first);
  await tick();
  first.lose();
  await tick();
  assert.equal(life.state.kind, "idle", "back to idle, so the owner can ensure again");
  life.ensure();
  const second = new FakeRenderer();
  pending[1]?.resolve(second);
  await tick();
  assert.equal(life.renderer, second);
  second.lose();
  await tick();
  assert.equal(life.state.kind, "unavailable");
  assert.deepEqual(seen, ["ready", "idle", "ready", "unavailable"]);
});

test("losing a renderer that was already released changes nothing", async () => {
  const { life, pending } = setup();
  life.ensure();
  const r = new FakeRenderer();
  pending[0]?.resolve(r);
  await tick();
  life.release();
  r.lose();
  await tick();
  assert.equal(life.state.kind, "idle");
});

test("without WebGPU, the browser provider fails with the reason", async () => {
  const { browserGpu, WebGpuUnavailableError } = await import("./gpu.ts");
  await assert.rejects(
    browserGpu(undefined).device(),
    (e: unknown) => e instanceof WebGpuUnavailableError && e.message === "This browser doesn’t provide WebGPU.",
  );
  const noAdapter = browserGpu({ requestAdapter: async () => null, getPreferredCanvasFormat: () => "bgra8unorm" });
  await assert.rejects(noAdapter.device(), /no graphics adapter/);
});
