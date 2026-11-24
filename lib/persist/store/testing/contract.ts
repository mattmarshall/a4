/**
 * The storage contract suites. Backends must pass them unchanged:
 *
 *   pageFilesContract("folder", async () => makeFolder(), (stem) => parseFilePath(`${stem}.md`));
 *   pageStoreContract("my library backend", async () => new MyPageStore(...));
 *
 * `pageFilesContract` covers the core every backend implements; `id` turns a
 * test stem into the backend's identifier. `pageStoreContract` runs the core
 * suite with page names, then the library operations.
 *
 * Revisions are opaque: the suites check only what callers rely on (a write's
 * revision is the next read's, it lets the next write through, and a stale
 * one is a conflict), so a view whose revisions are those of other bytes,
 * such as `sheetFiles`, passes the same tests. With `text: "sheet"`, the
 * suite stores only sheet text (no tab, CR, or leading byte-order mark), and
 * a page's size is checked against the list rather than against the text.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parsePageName } from "../names.ts";
import { isStoreError, type PageFiles, type PageStore } from "../types.ts";
import { forgePageName } from "./forge.ts";

const n = (s: string) => parsePageName(s);

async function rejectsWith(promise: Promise<unknown>, code: Parameters<typeof isStoreError>[1]) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(isStoreError(error, code), `expected ${code}, got ${String(error)}`);
    return true;
  });
}

export interface PageFilesContractOptions {
  /** "exact" (the default): text round-trips byte for byte. "sheet": only sheet text is stored. */
  readonly text?: "exact" | "sheet";
}

export function pageFilesContract<Id extends string>(
  label: string,
  makeStore: () => Promise<PageFiles<Id>>,
  id: (stem: string) => Id,
  options: PageFilesContractOptions = {},
): void {
  const exact = (options.text ?? "exact") === "exact";
  describe(`PageFiles contract: ${label}`, () => {
    test("starts empty", async () => {
      const store = await makeStore();
      assert.deepEqual(await store.list(), []);
    });

    test("create, list, and read round-trip text exactly", async () => {
      const store = await makeStore();
      const texts = ["Purpose: brief the agent.\n", "", "Unicode — “quotes”, café, 漢字\n\n  indented\n"];
      for (const [i, text] of texts.entries()) {
        const created = await store.create(id(`Page ${i}`), text);
        const page = await store.read(id(`Page ${i}`));
        assert.equal(page.text, text);
        assert.equal(page.revision, created.revision);
        assert.equal(page.size, created.size);
        if (exact) assert.equal(page.size, new TextEncoder().encode(text).length);
      }
      const listed = await store.list();
      const names = listed.map((p) => p.name).sort();
      assert.deepEqual(names, [id("Page 0"), id("Page 1"), id("Page 2")].sort());
      for (const summary of listed) assert.equal(summary.size, (await store.read(summary.name)).size);
    });

    const sheetOnly = exact ? false : "sheet text has no CR or byte-order mark";
    test("text round-trips exactly, including a leading byte-order mark", { skip: sheetOnly }, async () => {
      const store = await makeStore();
      const created = await store.create(id("Brief"), "\ufeffhello\r\n");
      const page = await store.read(id("Brief"));
      assert.equal(page.text, "\ufeffhello\r\n");
      assert.equal(page.revision, created.revision);
      const next = await store.write(id("Brief"), "\ufeffhello again", page.revision);
      assert.equal((await store.read(id("Brief"))).revision, next.revision);
    });

    test("text that isn't well-formed is refused and nothing is stored", async () => {
      const store = await makeStore();
      await rejectsWith(store.create(id("Brief"), "a\uD800b"), "invalid-text");
      assert.deepEqual(await store.list(), []);
      await store.create(id("Brief"), "ok");
      await rejectsWith(store.write(id("Brief"), "x\uDC00"), "invalid-text");
      assert.equal((await store.read(id("Brief"))).text, "ok");
    });

    test("create refuses an existing page and changes nothing", async () => {
      const store = await makeStore();
      await store.create(id("Brief"), "one");
      await rejectsWith(store.create(id("Brief"), "two"), "exists");
      assert.equal((await store.read(id("Brief"))).text, "one");
    });

    test("reading or writing a missing page fails with not-found", async () => {
      const store = await makeStore();
      await rejectsWith(store.read(id("Nope")), "not-found");
      await rejectsWith(store.write(id("Nope"), "x"), "not-found");
    });

    test("write replaces text and returns the new revision", async () => {
      const store = await makeStore();
      const first = await store.create(id("Brief"), "v1");
      const second = await store.write(id("Brief"), "v2", first.revision);
      assert.notEqual(second.revision, first.revision);
      const page = await store.read(id("Brief"));
      assert.equal(page.text, "v2");
      assert.equal(page.revision, second.revision);
      assert.ok(second.modifiedAt >= first.modifiedAt);
    });

    test("a stale expected revision is a conflict and changes nothing", async () => {
      const store = await makeStore();
      const first = await store.create(id("Brief"), "v1");
      await store.write(id("Brief"), "v2 from another tab");
      await rejectsWith(store.write(id("Brief"), "v2 from this tab", first.revision), "conflict");
      assert.equal((await store.read(id("Brief"))).text, "v2 from another tab");
    });

    test("identical content is not a conflict", async () => {
      const store = await makeStore();
      await store.create(id("Brief"), "v1");
      // Two tabs save the same text; either may write next with its revision.
      const first = await store.write(id("Brief"), "same");
      const second = await store.write(id("Brief"), "same");
      assert.equal(second.revision, first.revision);
      const ok = await store.write(id("Brief"), "next", first.revision);
      assert.equal((await store.read(id("Brief"))).revision, ok.revision);
    });

    test("holds an arbitrary number of pages", async () => {
      const store = await makeStore();
      for (let i = 0; i < 60; i++) await store.create(id(`Page ${i}`), `text ${i}`);
      assert.equal((await store.list()).length, 60);
      assert.equal((await store.read(id("Page 42"))).text, "text 42");
    });
  });
}

export interface PageStoreContractOptions {
  /**
   * Two stores over one storage and one set of locks, standing for two tabs.
   * Without it, the cases that race two tabs are skipped.
   */
  readonly tabs?: () => Promise<readonly [PageStore, PageStore]>;
}

const sortedNames = async (store: PageStore) => (await store.list()).map((p) => p.name as string).sort();

export function pageStoreContract(
  label: string,
  makeStore: () => Promise<PageStore>,
  options: PageStoreContractOptions = {},
): void {
  pageFilesContract(label, makeStore, n);
  const tabs = options.tabs;
  const needsTabs = tabs ? false : "needs two tabs over one storage";
  describe(`PageStore contract: ${label}`, () => {
    test("starts with an empty trash", async () => {
      const store = await makeStore();
      assert.deepEqual(await store.listTrash(), []);
    });

    test("names are unique ignoring case", async () => {
      const store = await makeStore();
      await store.create(n("Brief"), "one");
      await rejectsWith(store.create(n("brief"), "two"), "exists");
      assert.equal((await store.read(n("Brief"))).text, "one");
    });

    test("createUnique takes the first free name, ignoring case", async () => {
      const store = await makeStore();
      await store.create(n("Brief"), "one");
      const second = await store.createUnique("brief", "two");
      const third = await store.createUnique("Brief", "three");
      assert.equal(second.name, "brief 2");
      assert.equal(third.name, "Brief 3");
      assert.equal((await store.read(n("brief 2"))).text, "two");
      assert.equal((await store.read(third.name)).revision, third.revision);
      const fresh = await store.createUnique("New page", "");
      assert.equal(fresh.name, "New page");
    });

    test("createUnique refuses text that isn't well-formed and stores nothing", async () => {
      const store = await makeStore();
      await rejectsWith(store.createUnique("Brief", "a\uD800b"), "invalid-text");
      assert.deepEqual(await store.list(), []);
    });

    test("two tabs creating a page at once get different names", { skip: needsTabs }, async () => {
      const [a, b] = await (tabs as NonNullable<typeof tabs>)();
      const [one, two] = await Promise.all([a.createUnique("Untitled", "one"), b.createUnique("Untitled", "two")]);
      assert.deepEqual([one.name, two.name].sort(), ["Untitled", "Untitled 2"]);
      assert.equal((await a.read(one.name)).text, "one");
      assert.equal((await a.read(two.name)).text, "two");
    });

    test("a restore racing a create in another tab gets its own name", { skip: needsTabs }, async () => {
      const [a, b] = await (tabs as NonNullable<typeof tabs>)();
      await a.create(n("Brief"), "old");
      const entry = await a.trash(n("Brief"));
      const [restored, created] = await Promise.all([a.restore(entry.id), b.createUnique("Brief", "new")]);
      assert.deepEqual(await sortedNames(a), ["Brief", "Brief 2"]);
      assert.equal((await a.read(restored.name)).text, "old");
      assert.equal((await a.read(created.name)).text, "new");
    });

    test("a rename racing a create of its target: one fails with name taken, no text is lost", {
      skip: needsTabs,
    }, async () => {
      const [a, b] = await (tabs as NonNullable<typeof tabs>)();
      await a.create(n("Notes"), "renamed");
      const [renamed, created] = await Promise.allSettled([
        a.rename(n("Notes"), n("Brief")),
        b.create(n("Brief"), "created"),
      ]);
      const failed = [renamed, created].filter((r) => r.status === "rejected");
      assert.equal(failed.length, 1);
      assert.ok(isStoreError((failed[0] as PromiseRejectedResult).reason, "exists"));
      const texts = await Promise.all((await a.list()).map(async (p) => (await a.read(p.name)).text));
      if (renamed.status === "fulfilled") {
        assert.deepEqual(await sortedNames(a), ["Brief"]);
        assert.deepEqual(texts, ["renamed"]);
      } else {
        assert.deepEqual(await sortedNames(a), ["Brief", "Notes"]);
        assert.deepEqual(texts.sort(), ["created", "renamed"]);
      }
    });

    test("two tabs renaming in opposite directions both finish", { skip: needsTabs }, async () => {
      const [a, b] = await (tabs as NonNullable<typeof tabs>)();
      await a.create(n("One"), "text");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadlock = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("the renames deadlocked")), 2000);
      });
      try {
        await Promise.race([
          Promise.allSettled([a.rename(n("One"), n("Two")), b.rename(n("Two"), n("One"))]),
          deadlock,
        ]);
      } finally {
        clearTimeout(timer);
      }
      const names = await sortedNames(a);
      assert.equal(names.length, 1);
      assert.equal((await a.read(n(names[0] as string))).text, "text");
    });

    test("invalid names are rejected", async () => {
      const store = await makeStore();
      await rejectsWith(store.create(forgePageName("a/b"), "x"), "invalid-name");
      await rejectsWith(store.create(forgePageName(".hidden"), "x"), "invalid-name");
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
  });
}
