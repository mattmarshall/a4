/**
 * The `PageStore` contract suite. Every backend must pass it unchanged:
 *
 *   pageStoreContract("my backend", async () => new MyPageStore(...));
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parsePageName } from "../names.ts";
import { revisionOf } from "../revision.ts";
import { isStoreError, type PageName, type PageStore, type Revision } from "../types.ts";

const n = (s: string) => parsePageName(s);

async function rejectsWith(promise: Promise<unknown>, code: Parameters<typeof isStoreError>[1]) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(isStoreError(error, code), `expected ${code}, got ${String(error)}`);
    return true;
  });
}

export function pageStoreContract(label: string, makeStore: () => Promise<PageStore>): void {
  describe(`PageStore contract: ${label}`, () => {
    test("starts empty", async () => {
      const store = await makeStore();
      assert.deepEqual(await store.list(), []);
      assert.deepEqual(await store.listTrash(), []);
    });

    test("create, list, and read round-trip text exactly", async () => {
      const store = await makeStore();
      const texts = ["Purpose: brief the agent.\n", "", "Unicode — “quotes”, café, 漢字\n\n  indented\n"];
      for (const [i, text] of texts.entries()) {
        const created = await store.create(n(`Page ${i}`), text);
        assert.equal(created.revision, revisionOf(text));
        const page = await store.read(n(`Page ${i}`));
        assert.equal(page.text, text);
        assert.equal(page.revision, revisionOf(text));
        assert.equal(page.size, new TextEncoder().encode(text).length);
      }
      const names = (await store.list()).map((p) => p.name).sort();
      assert.deepEqual(names, ["Page 0", "Page 1", "Page 2"]);
    });

    test("names are unique ignoring case", async () => {
      const store = await makeStore();
      await store.create(n("Brief"), "one");
      await rejectsWith(store.create(n("brief"), "two"), "exists");
      assert.equal((await store.read(n("Brief"))).text, "one");
    });

    test("invalid names are rejected", async () => {
      const store = await makeStore();
      await rejectsWith(store.create("a/b" as PageName, "x"), "invalid-name");
      await rejectsWith(store.create(".hidden" as PageName, "x"), "invalid-name");
    });

    test("reading or writing a missing page fails with not-found", async () => {
      const store = await makeStore();
      await rejectsWith(store.read(n("Nope")), "not-found");
      await rejectsWith(store.write(n("Nope"), "x"), "not-found");
    });

    test("write replaces text and returns the new revision", async () => {
      const store = await makeStore();
      const first = await store.create(n("Brief"), "v1");
      const second = await store.write(n("Brief"), "v2", first.revision);
      assert.equal(second.revision, revisionOf("v2"));
      assert.equal((await store.read(n("Brief"))).text, "v2");
      assert.ok(second.modifiedAt >= first.modifiedAt);
    });

    test("a stale expected revision is a conflict and changes nothing", async () => {
      const store = await makeStore();
      const first = await store.create(n("Brief"), "v1");
      await store.write(n("Brief"), "v2 from another tab");
      await rejectsWith(store.write(n("Brief"), "v2 from this tab", first.revision), "conflict");
      assert.equal((await store.read(n("Brief"))).text, "v2 from another tab");
    });

    test("identical content is not a conflict", async () => {
      const store = await makeStore();
      await store.create(n("Brief"), "v1");
      await store.write(n("Brief"), "same");
      const ok = await store.write(n("Brief"), "next", revisionOf("same") as Revision);
      assert.equal(ok.revision, revisionOf("next"));
    });

    test("rename moves the text; clashes and missing pages are rejected", async () => {
      const store = await makeStore();
      await store.create(n("Notes"), "text");
      await store.create(n("Brief"), "other");
      await rejectsWith(store.rename(n("Notes"), n("brief")), "exists");
      await rejectsWith(store.rename(n("Missing"), n("X")), "not-found");
      const renamed = await store.rename(n("Notes"), n("Field notes"));
      assert.equal(renamed.name, "Field notes");
      assert.equal((await store.read(n("Field notes"))).text, "text");
      await rejectsWith(store.read(n("Notes")), "not-found");
    });

    test("rename to a case variant of the same name is allowed", async () => {
      const store = await makeStore();
      await store.create(n("brief"), "text");
      await store.rename(n("brief"), n("Brief"));
      assert.deepEqual(
        (await store.list()).map((p) => p.name),
        ["Brief"],
      );
      assert.equal((await store.read(n("Brief"))).text, "text");
    });

    test("trash, restore, and purge", async () => {
      const store = await makeStore();
      await store.create(n("Brief"), "keep me");
      const entry = await store.trash(n("Brief"));
      assert.equal(entry.name, "Brief");
      assert.deepEqual(await store.list(), []);
      assert.deepEqual(
        (await store.listTrash()).map((t) => t.id),
        [entry.id],
      );
      const restored = await store.restore(entry.id);
      assert.equal(restored.name, "Brief");
      assert.equal((await store.read(n("Brief"))).text, "keep me");
      assert.deepEqual(await store.listTrash(), []);

      const again = await store.trash(n("Brief"));
      await store.purge(again.id);
      assert.deepEqual(await store.listTrash(), []);
      await rejectsWith(store.purge(again.id), "not-found");
      await rejectsWith(store.restore(again.id), "not-found");
    });

    test("trashing the same name twice keeps both; restore picks a free name", async () => {
      const store = await makeStore();
      await store.create(n("Brief"), "first");
      const a = await store.trash(n("Brief"));
      await store.create(n("Brief"), "second");
      const b = await store.trash(n("Brief"));
      assert.notEqual(a.id, b.id);
      await store.create(n("Brief"), "third");
      const restored = await store.restore(a.id);
      assert.equal(restored.name, "Brief 2");
      assert.equal((await store.read(n("Brief 2"))).text, "first");
      assert.equal((await store.read(n("Brief"))).text, "third");
    });

    test("holds an arbitrary number of pages", async () => {
      const store = await makeStore();
      for (let i = 0; i < 60; i++) await store.create(n(`Page ${i}`), `text ${i}`);
      assert.equal((await store.list()).length, 60);
      assert.equal((await store.read(n("Page 42"))).text, "text 42");
    });
  });
}
