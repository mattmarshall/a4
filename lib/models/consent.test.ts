import assert from "node:assert/strict";
import { test } from "node:test";
import { create } from "@bufbuild/protobuf";
import { ModelCardSchema, Operation, Placement, View } from "../gen/a4/v1/model_pb.js";
import { PRESETS } from "../page-spec.ts";
import { implement } from "./client.ts";
import { grantConsent, type ConsentToken } from "./consent.ts";
import { ModelError } from "./errors.ts";
import { ModelHost } from "./host.ts";

const T = PRESETS.terminal;

function remote() {
  const calls: string[] = [];
  const card = create(ModelCardSchema, {
    id: "remote",
    name: "Remote",
    operations: [Operation.TRANSFORM],
    views: [View.TEXT],
    placement: Placement.REMOTE,
    sendsTextOffDevice: true,
    destinationHost: "api.example.com",
  });
  const host = new ModelHost();
  host.register({
    card,
    connect: async () =>
      implement({
        describe: () => ({ card }),
        async *transform(req) {
          calls.push(req.sheet!.text);
          yield { event: { case: "candidate", value: { text: "short", model: "m" } } };
        },
      }),
  });
  return { host, calls };
}

const refused = (e: unknown) => e instanceof ModelError && e.code === "consent-required";

test("consent: a remote plugin without a token is never contacted", async () => {
  const { host, calls } = remote();
  await assert.rejects(host.transform("remote", "page", T, { instruction: "fit" }), refused);
  assert.deepEqual(calls, []);
});

test("consent: a token works once; reusing it is refused before the plugin runs", async () => {
  const { host, calls } = remote();
  const token = grantConsent("remote", "page");
  const result = await host.transform("remote", "page", T, { instruction: "fit", consent: token });
  assert.equal(result.text, "short");
  await assert.rejects(host.transform("remote", "page", T, { instruction: "fit", consent: token }), refused);
  assert.deepEqual(calls, ["page"], "the plugin ran exactly once");
});

test("consent: a token for different text is refused before the plugin runs", async () => {
  const { host, calls } = remote();
  const token = grantConsent("remote", "page as confirmed");
  await assert.rejects(host.transform("remote", "page as edited", T, { instruction: "fit", consent: token }), refused);
  assert.deepEqual(calls, []);
});

test("consent: a token for another plugin, or a forged one, is refused", async () => {
  const { host, calls } = remote();
  await assert.rejects(
    host.transform("remote", "page", T, { instruction: "fit", consent: grantConsent("other", "page") }),
    refused,
  );
  const forged = { pluginId: "remote", revision: "x", characters: 4 } as unknown as ConsentToken;
  await assert.rejects(host.transform("remote", "page", T, { instruction: "fit", consent: forged }), refused);
  assert.deepEqual(calls, []);
});

test("consent: in-browser plugins need no token", async () => {
  const card = create(ModelCardSchema, {
    id: "local",
    name: "Local",
    operations: [Operation.TRANSFORM],
    placement: Placement.BROWSER,
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
  assert.equal((await host.transform("local", "page", T, { instruction: "fit" })).text, "ok");
});
