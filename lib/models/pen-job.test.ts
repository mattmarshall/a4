import { test } from "node:test";
import assert from "node:assert/strict";
import { ErrorCode, ModelError } from "./errors.ts";
import type { TransformResult } from "./host.ts";
import { PenJob, type PenRunOptions } from "./pen-job.ts";

const result: TransformResult = {
  text: "short",
  model: "m",
  rowsUsed: 10,
  rowsAllowed: 60,
  fits: true,
  overBy: 0,
  attempts: 1,
  maxAttempts: 3,
};

function setup(run: (text: string, options: PenRunOptions) => Promise<TransformResult>) {
  const granted: string[] = [];
  const opened: string[] = [];
  let authFailed = 0;
  const job = new PenJob<string>({
    grant: (text) => {
      granted.push(text);
      return { pluginId: "fit", text } as never;
    },
    run,
    onResult: async (name, r, ref) => {
      opened.push(`${name}|${ref}|${r.text}`);
    },
    onAuthFailed: () => authFailed++,
  });
  const states: string[] = [];
  job.subscribe(() => states.push(job.state.kind));
  return { job, granted, opened, states, authFailed: () => authFailed };
}

test("ask, send, progress, and result: consent is for the exact text shown", async () => {
  let progress: PenRunOptions["onProgress"] = () => {};
  let finish: () => void = () => {};
  const { job, granted, opened, states } = setup((_text, options) => {
    progress = options.onProgress;
    return new Promise((resolve) => (finish = () => resolve(result)));
  });
  job.ask({ name: "Brief", ref: "ref-brief", text: "long text" });
  assert.equal(job.state.kind, "confirm");
  const sending = job.send();
  assert.deepEqual(granted, ["long text"]);
  // The most attempts is unknown until the host reports it.
  assert.deepEqual(
    { ...job.state },
    {
      kind: "running",
      name: "Brief",
      attempt: 1,
      maxAttempts: null,
      characters: 0,
      note: null,
    },
  );
  progress({ attempt: 2, maxAttempts: 3, characters: 120 });
  assert.deepEqual(
    { ...job.state },
    {
      kind: "running",
      name: "Brief",
      attempt: 2,
      maxAttempts: 3,
      characters: 120,
      note: null,
    },
  );
  finish();
  await sending;
  assert.deepEqual(opened, ["Brief|ref-brief|short"]);
  assert.equal(job.state.kind, "idle");
  assert.deepEqual(states, ["confirm", "running", "running", "idle"]);
});

test("cancel aborts the run and reports that no page was created", async () => {
  const { job } = setup(
    (_text, options) =>
      new Promise((_resolve, reject) =>
        options.signal.addEventListener("abort", () => reject(new ModelError(ErrorCode.CANCELED, "Canceled."))),
      ),
  );
  job.ask({ name: "Brief", ref: "r", text: "x" });
  const sending = job.send();
  job.cancel();
  await sending;
  assert.deepEqual(job.state, { kind: "failed", message: "Canceled. No page was created." });
});

test("a rejected key is reported and forgotten; send without confirm does nothing", async () => {
  const { job, authFailed, granted } = setup(async () => {
    throw new ModelError(ErrorCode.AUTH, "The key was not accepted.");
  });
  await job.send();
  assert.equal(granted.length, 0);
  job.ask({ name: "Brief", ref: "r", text: "x" });
  await job.send();
  assert.equal(authFailed(), 1);
  assert.equal(job.state.kind, "failed");
  job.dismiss();
  assert.equal(job.state.kind, "idle");
});

test("asking again while a rewrite runs is ignored", async () => {
  let finish: () => void = () => {};
  const { job } = setup(() => new Promise((resolve) => (finish = () => resolve(result))));
  job.ask({ name: "A", ref: "a", text: "one" });
  const sending = job.send();
  job.ask({ name: "B", ref: "b", text: "two" });
  assert.equal(job.state.kind, "running");
  finish();
  await sending;
});

test("an installed pen that crashes mid-run ends the run within 1 second, and no page is made", async () => {
  const { MemoryPluginStore } = await import("../platform/plugin-store.ts");
  const { PluginRegistry } = await import("./registry.ts");
  const { packPackage, cardFromJson } = await import("./package.ts");
  const { pluginIdOf } = await import("./plugin-id.ts");
  const { PRESETS } = await import("../page/index.ts");
  const { fakeSandbox } = await import("./testing/sandbox.ts");
  const { SAMPLE_CODE, testKey } = await import("./testing/packages.ts");
  const card = cardFromJson(
    JSON.stringify({
      id: "example.stuck-pen",
      name: "Stuck pen",
      version: "1.0.0",
      operations: ["OPERATION_TRANSFORM"],
      views: ["VIEW_TEXT"],
      browser: {},
      transform: { instructions: ["Rewrite"], maxAttempts: 1 },
    }),
  );
  let reached: () => void = () => {};
  const inside = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const sandbox = fakeSandbox(card, () => ({
    async *transform() {
      reached();
      await new Promise(() => {}); // never answers
    },
  }));
  const registry = new PluginRegistry({
    store: new MemoryPluginStore(),
    fetch: globalThis.fetch,
    open: sandbox.open,
    sandboxWorks: async () => true,
    channel: null,
  });
  const key = testKey();
  const bytes = await packPackage({
    card,
    publisherName: "Example",
    publicKey: key.publicKey,
    code: SAMPLE_CODE,
    files: [],
    signedAt: new Date(),
    sign: key.sign,
  });
  await registry.install(await registry.inspect(bytes));
  const pages: string[] = [];
  const job = new PenJob<string>({
    grant: () => {
      throw new Error("an on-device pen never asks for consent");
    },
    run: (text, options) =>
      registry.host.transform(pluginIdOf(card), text, PRESETS.terminal, { instruction: "Rewrite", ...options }),
    onResult: async (name) => {
      pages.push(name);
    },
  });
  const running = job.run({ name: "Notes", ref: "notes", text: "Some text." });
  await inside;
  const crashedAt = Date.now();
  sandbox.opened[0]?.crash("The plugin failed: boom");
  await running;
  assert.ok(Date.now() - crashedAt < 1000, `ended ${Date.now() - crashedAt} ms after the crash`);
  assert.equal(job.state.kind, "failed");
  assert.match(job.state.kind === "failed" ? job.state.message : "", /No page was created/);
  assert.deepEqual(pages, []);
  registry.host.unregister(pluginIdOf(card));
});
