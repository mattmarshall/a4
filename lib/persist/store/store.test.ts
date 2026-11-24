import { test } from "node:test";
import assert from "node:assert/strict";
import { KeyValuePageStore, MemoryPageStore } from "./key-value.ts";
import { MemoryKeyValue } from "../../platform/key-value.ts";
import { nameFromText, nextAvailableName, parsePageName, sanitizePageName } from "./names.ts";
import { movePages } from "./open.ts";
import { OpfsPageStore } from "./opfs.ts";
import { revisionOf } from "./revision.ts";
import { pageStoreContract } from "./testing/contract.ts";
import { asDirectoryHandle, FakeDirectoryHandle } from "./testing/fake-opfs.ts";
import { isStoreError } from "./types.ts";

// Every backend passes the same contract.
pageStoreContract("memory", async () => new MemoryPageStore());
pageStoreContract(
  "key-value (localStorage layout)",
  async () => new KeyValuePageStore(new MemoryKeyValue(), { kind: "local-storage", durable: true }),
);
pageStoreContract("OPFS (in-memory fake)", async () =>
  OpfsPageStore.open(asDirectoryHandle(new FakeDirectoryHandle()), { locks: null }),
);

test("name rules", () => {
  assert.equal(parsePageName("  Agent   charter  "), "Agent charter");
  for (const bad of [
    "",
    "   ",
    "a/b",
    "a\\b",
    "a:b",
    "what?",
    'say "hi"',
    "<x>",
    "a|b",
    ".env",
    "x".repeat(81),
    "bell\u0007",
  ]) {
    assert.throws(
      () => parsePageName(bad),
      (e: unknown) => isStoreError(e, "invalid-name"),
      JSON.stringify(bad),
    );
  }
  assert.equal(parsePageName("x".repeat(80)).length, 80);
  assert.equal(parsePageName("tab\there"), "tab here");
  assert.equal(parsePageName("INCIDENT INC-2291 · Checkout latency"), "INCIDENT INC-2291 · Checkout latency");
});

test("sanitizing and naming from text", () => {
  assert.equal(sanitizePageName("INCIDENT INC-2291: Checkout latency"), "INCIDENT INC-2291 Checkout latency");
  assert.equal(sanitizePageName("...hidden"), "hidden");
  assert.equal(sanitizePageName("///"), "Untitled");
  assert.equal(nameFromText("\n\n  HANDOFF · Billing export  \nbody"), "HANDOFF · Billing export");
  assert.equal(nameFromText("   \n"), "Untitled");
  assert.equal(nameFromText("x".repeat(200)).length, 80);
});

test("next available name adds a numeric suffix, ignoring case", () => {
  assert.equal(nextAvailableName("Untitled", []), "Untitled");
  assert.equal(nextAvailableName("Untitled", ["untitled"]), "Untitled 2");
  assert.equal(nextAvailableName("Untitled", ["Untitled", "Untitled 2"]), "Untitled 3");
  const long = "y".repeat(80);
  const next = nextAvailableName(long, [long]);
  assert.equal(next.length, 80);
  assert.ok(next.endsWith(" 2"));
});

test("revisions depend only on content", () => {
  assert.equal(revisionOf("abc"), revisionOf("abc"));
  assert.notEqual(revisionOf("abc"), revisionOf("abd"));
  assert.notEqual(revisionOf(""), revisionOf(" "));
});

test("OPFS layout: a4/pages/<name>.md holds exactly the page text", async () => {
  const root = new FakeDirectoryHandle();
  const store = await OpfsPageStore.open(asDirectoryHandle(root), { locks: null });
  await store.create(parsePageName("Brief"), "Purpose: brief the agent.\n");
  assert.equal(root.fileAt("a4/pages/Brief.md")?.text, "Purpose: brief the agent.\n");
  const entry = await store.trash(parsePageName("Brief"));
  assert.equal(root.fileAt("a4/pages/Brief.md"), undefined);
  assert.equal(root.fileAt(`a4/trash/${entry.id}.md`)?.text, "Purpose: brief the agent.\n");
});

test("OPFS ignores non-page files such as swap files", async () => {
  const root = new FakeDirectoryHandle();
  const store = await OpfsPageStore.open(asDirectoryHandle(root), { locks: null });
  await store.create(parsePageName("Brief"), "x");
  const pages = await (await root.getDirectoryHandle("a4")).getDirectoryHandle("pages");
  await pages.getFileHandle("Brief.md.crswap", { create: true });
  await pages.getFileHandle("notes.txt", { create: true });
  await pages.getDirectoryHandle("folder", { create: true });
  assert.deepEqual(
    (await store.list()).map((p) => p.name),
    ["Brief"],
  );
});

test("OPFS: an interrupted write leaves the previous text intact", async () => {
  const root = new FakeDirectoryHandle();
  const store = await OpfsPageStore.open(asDirectoryHandle(root), { locks: null });
  await store.create(parsePageName("Brief"), "complete previous text");
  const file = root.fileAt("a4/pages/Brief.md");
  assert.ok(file);
  file.failNextWrite = true;
  await assert.rejects(store.write(parsePageName("Brief"), "new text that fails halfway"));
  assert.equal((await store.read(parsePageName("Brief"))).text, "complete previous text");
});

test("OPFS writes run inside a per-page lock", async () => {
  const requested: string[] = [];
  const locks = {
    request: async <T>(name: string, fn: () => Promise<T>) => {
      requested.push(name);
      return fn();
    },
  };
  const store = await OpfsPageStore.open(asDirectoryHandle(new FakeDirectoryHandle()), { locks });
  await store.create(parsePageName("Brief"), "x");
  await store.write(parsePageName("Brief"), "y");
  assert.deepEqual(requested, ["a4:page:brief", "a4:page:brief"]);
});

test("moving pages from the fallback store into OPFS keeps every page", async () => {
  const fallback = new KeyValuePageStore(new MemoryKeyValue(), { kind: "local-storage", durable: true });
  await fallback.create(parsePageName("Brief"), "from fallback");
  await fallback.create(parsePageName("Charter"), "charter");
  const opfs = await OpfsPageStore.open(asDirectoryHandle(new FakeDirectoryHandle()), { locks: null });
  await opfs.create(parsePageName("Brief"), "already in opfs");
  assert.equal(await movePages(fallback, opfs), 2);
  assert.deepEqual(await fallback.list(), []);
  assert.deepEqual(await fallback.listTrash(), []);
  const names = (await opfs.list()).map((p) => p.name).sort();
  assert.deepEqual(names, ["Brief", "Brief 2", "Charter"]);
  assert.equal((await opfs.read(parsePageName("Brief 2"))).text, "from fallback");
  assert.equal((await opfs.read(parsePageName("Brief"))).text, "already in opfs");
});

test("sanitized names always parse, and never split a surrogate pair", () => {
  assert.equal(sanitizePageName(" . .x"), "x");
  assert.equal(sanitizePageName(" . "), "Untitled");
  assert.equal(sanitizePageName("...."), "Untitled");
  assert.equal(sanitizePageName("a\uD800b"), "a�b");
  const longEmoji = `${"x".repeat(79)}😀tail`;
  const cut = sanitizePageName(longEmoji);
  assert.ok(cut.isWellFormed(), JSON.stringify(cut));
  assert.ok(cut.length <= 80);
  const taken = [`${"y".repeat(78)}😀`];
  const next = nextAvailableName(`${"y".repeat(78)}😀`, taken);
  assert.ok(next.isWellFormed() && next.endsWith(" 2"), next);
  assert.throws(
    () => parsePageName("a\uD800"),
    (e: unknown) => isStoreError(e, "invalid-name"),
  );
});

test("OPFS: a failed first write leaves no empty page, and moves change nothing", async () => {
  const root = new FakeDirectoryHandle();
  const store = await OpfsPageStore.open(asDirectoryHandle(root), { locks: null });
  await store.create(parsePageName("Brief"), "keep me");
  root.volume.failWritable = true;
  await assert.rejects(store.create(parsePageName("Fresh"), "x"));
  await assert.rejects(store.rename(parsePageName("Brief"), parsePageName("Renamed")));
  await assert.rejects(store.trash(parsePageName("Brief")));
  assert.deepEqual(
    (await store.list()).map((p) => p.name),
    ["Brief"],
  );
  assert.deepEqual(await store.listTrash(), []);
  root.volume.failWritable = false;
  const entry = await store.trash(parsePageName("Brief"));
  root.volume.failWritable = true;
  await assert.rejects(store.restore(entry.id));
  assert.deepEqual(await store.list(), []);
  assert.deepEqual(
    (await store.listTrash()).map((t) => t.id),
    [entry.id],
  );
  root.volume.failWritable = false;
  assert.equal((await store.read((await store.restore(entry.id)).name)).text, "keep me");
});
