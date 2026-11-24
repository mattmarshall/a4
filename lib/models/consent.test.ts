import assert from "node:assert/strict";
import { test } from "node:test";
import { create } from "@bufbuild/protobuf";
import { ModelCardSchema, Operation, View } from "../gen/a4/v1/model_pb.js";
import { PRESETS } from "../page/index.ts";
import { implement } from "./client.ts";
import type { ConsentToken } from "./consent.ts";
import { ErrorCode, ModelError } from "./errors.ts";
import { ModelHost } from "./host.ts";
import { pluginIdOf } from "./plugin-id.ts";

/** A plugin id, minted from a card as the host mints them. */
const pid = (id: string) => pluginIdOf(create(ModelCardSchema, { id }));

const T = PRESETS.terminal;

function remote() {
  const calls: string[] = [];
  const card = create(ModelCardSchema, {
    id: "remote",
    name: "Remote",
    operations: [Operation.TRANSFORM],
    transform: { instructions: ["fit"], maxAttempts: 3 },
    views: [View.TEXT],
    placement: { case: "remote", value: { destinationHost: "api.example.com" } },
  });
  const host = new ModelHost();
  host.register({
    card,
    connect: async () =>
      implement({
        describe: () => ({ card }),
        async *transform(req) {
          calls.push(req.sheet?.text ?? "");
          yield { event: { case: "candidate", value: { text: "short", model: "m" } } };
        },
      }),
  });
  return { host, calls };
}

const refused = (e: unknown) => e instanceof ModelError && e.code === ErrorCode.CONSENT_REQUIRED;

test("consent: a remote plugin without a token is never contacted", async () => {
  const { host, calls } = remote();
  await assert.rejects(host.transform(pid("remote"), "page", T, { instruction: "fit" }), refused);
  assert.deepEqual(calls, []);
});

test("consent: a token works once; reusing it is refused before the plugin runs", async () => {
  const { host, calls } = remote();
  const token = host.consent.request(pid("remote"), Operation.TRANSFORM, "page").approve();
  const result = await host.transform(pid("remote"), "page", T, { instruction: "fit", consent: token });
  assert.equal(result.text, "short");
  await assert.rejects(host.transform(pid("remote"), "page", T, { instruction: "fit", consent: token }), refused);
  assert.deepEqual(calls, ["page"], "the plugin ran exactly once");
});

test("consent: a token for different text is refused before the plugin runs", async () => {
  const { host, calls } = remote();
  const token = host.consent.request(pid("remote"), Operation.TRANSFORM, "page as confirmed").approve();
  await assert.rejects(
    host.transform(pid("remote"), "page as edited", T, { instruction: "fit", consent: token }),
    refused,
  );
  assert.deepEqual(calls, []);
});

test("consent: a token for another plugin, or a forged one, is refused", async () => {
  const { host, calls } = remote();
  await assert.rejects(
    host.transform(pid("remote"), "page", T, {
      instruction: "fit",
      consent: host.consent.request(pid("other"), Operation.TRANSFORM, "page").approve(),
    }),
    refused,
  );
  const forged = { pluginId: "remote", operation: Operation.TRANSFORM, text: "page" } as unknown as ConsentToken;
  await assert.rejects(host.transform(pid("remote"), "page", T, { instruction: "fit", consent: forged }), refused);
  assert.deepEqual(calls, []);
});

test("consent: in-browser plugins need no token", async () => {
  const card = create(ModelCardSchema, {
    id: "local",
    name: "Local",
    operations: [Operation.TRANSFORM],
    transform: { instructions: ["fit"], maxAttempts: 3 },
    placement: { case: "browser", value: {} },
    views: [View.TEXT],
  });
  const host = new ModelHost();
  host.register({
    card,
    connect: async () =>
      implement({
        describe: () => ({ card }),
        async *transform() {
          yield { event: { case: "candidate", value: { text: "ok", model: "m" } } };
        },
      }),
  });
  assert.equal((await host.transform(pid("local"), "page", T, { instruction: "fit" })).text, "ok");
});

test("consent: a request is approved once, and its token is for that operation only", async () => {
  const { host, calls } = remote();
  const request = host.consent.request(pid("remote"), Operation.SCORE, "page");
  const token = request.approve();
  assert.throws(() => request.approve(), refused);
  await assert.rejects(host.transform(pid("remote"), "page", T, { instruction: "fit", consent: token }), refused);
  assert.deepEqual(calls, []);
});

test("consent: one token covers the repair attempts of one transform", async () => {
  const card = create(ModelCardSchema, {
    id: "remote",
    name: "Remote",
    operations: [Operation.TRANSFORM],
    transform: { instructions: ["fit"], maxAttempts: 3 },
    views: [View.TEXT],
    placement: { case: "remote", value: { destinationHost: "api.example.com" } },
  });
  const host = new ModelHost();
  let attempts = 0;
  host.register({
    card,
    connect: async () =>
      implement({
        describe: () => ({ card }),
        async *transform() {
          attempts++;
          const text = attempts < 3 ? "line\n".repeat(70) : "short";
          yield { event: { case: "candidate", value: { text, model: "m" } } };
        },
      }),
  });
  const token = host.consent.request(pid("remote"), Operation.TRANSFORM, "page").approve();
  const result = await host.transform(pid("remote"), "page", T, { instruction: "fit", consent: token });
  assert.equal(result.fits, true);
  assert.equal(attempts, 3);
});

test("consent: remote scoring goes through the same guard", async () => {
  const card = create(ModelCardSchema, {
    id: "remote-scorer",
    operations: [Operation.SCORE],
    views: [View.TEXT],
    placement: { case: "remote", value: { destinationHost: "api.example.com" } },
  });
  const host = new ModelHost();
  let contacted = false;
  host.register({
    card,
    connect: async () => {
      contacted = true;
      return implement({ describe: () => ({ card }) });
    },
  });
  await assert.rejects(host.score(pid("remote-scorer"), "page", T), refused);
  assert.equal(contacted, false);
});
