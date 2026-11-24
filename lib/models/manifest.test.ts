import { test } from "node:test";
import assert from "node:assert/strict";
import { create } from "@bufbuild/protobuf";
import { ModelCardSchema, Operation, View } from "../gen/a4/v1/model_pb.js";
import { implement } from "./client.ts";
import { isModelError } from "./errors.ts";
import { cardsOf, definePlugin, isDownloaded, MANIFEST, needsDownload } from "./manifest.ts";
import { pluginIdOf } from "./plugin-id.ts";
import { createHost } from "./registry.ts";

function fakeDescriptor(downloadBytes: bigint) {
  const card = create(ModelCardSchema, {
    id: "fake-scorer",
    name: "Fake scorer",
    version: "1",
    operations: [Operation.SCORE],
    views: [View.TEXT],
    placement: { case: "browser", value: {} },
    downloadBytes,
  });
  return { id: pluginIdOf(card), card, names: {} };
}

test("the bundled manifest: unique ids, and a download check exactly where a model downloads", () => {
  const ids = MANIFEST.map((p) => p.descriptor.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const plugin of MANIFEST) {
    assert.equal(plugin.descriptor.card.id, plugin.descriptor.id);
    assert.equal(Boolean(plugin.isDownloaded), needsDownload(plugin.descriptor.card), plugin.descriptor.id);
  }
});

test("adding a plugin takes only a manifest entry: the cards, the host, and the download check follow", async () => {
  const fake = definePlugin({
    descriptor: { ...fakeDescriptor(BigInt(1000)), downloads: true },
    connect: async () =>
      implement({
        describe: () => ({ card: fakeDescriptor(BigInt(1000)).card }),
        status: () => ({ ready: true }),
      }),
    isDownloaded: async () => true,
  });
  const manifest = [...MANIFEST, fake];
  const id = fake.descriptor.id;

  assert.deepEqual(
    cardsOf(manifest).map((c) => c.id),
    [...MANIFEST.map((p) => p.descriptor.id), "fake-scorer"],
  );
  const host = createHost(manifest);
  assert.ok(host.list().some((c) => c.id === "fake-scorer"));
  assert.equal(await isDownloaded(id, manifest), true);
  assert.equal(await host.status(id), true);
});

test("a plugin without a check, or whose check fails, counts as not downloaded", async () => {
  const none = definePlugin({
    descriptor: { ...fakeDescriptor(BigInt(0)), downloads: false },
    connect: async () => implement({}),
  });
  assert.equal(await isDownloaded(none.descriptor.id, [none]), false);

  const broken = definePlugin({
    descriptor: { ...fakeDescriptor(BigInt(1000)), downloads: true },
    connect: async () => implement({}),
    isDownloaded: async () => {
      throw new Error("no Cache Storage here");
    },
  });
  assert.equal(await isDownloaded(broken.descriptor.id, [broken]), false);
});

test("needing a download follows download_bytes, not where the plugin sends text", () => {
  assert.equal(needsDownload(fakeDescriptor(BigInt(1000)).card), true);
  assert.equal(needsDownload(fakeDescriptor(BigInt(0)).card), false);
});

test("a descriptor's download flag must match its card", () => {
  assert.throws(
    () =>
      definePlugin({
        descriptor: { ...fakeDescriptor(BigInt(1000)), downloads: false },
        connect: async () => implement({}),
      }),
    (error: unknown) => isModelError(error),
  );
  definePlugin({
    descriptor: { ...fakeDescriptor(BigInt(1000)), downloads: true as const },
    connect: async () => implement({}),
    // @ts-expect-error A plugin that downloads must say how to check it's downloaded.
    isDownloaded: undefined,
  });
});
