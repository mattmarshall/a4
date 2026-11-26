import { test } from "node:test";
import assert from "node:assert/strict";
import { KeyValuePageStore, MemoryPageStore } from "./key-value.ts";
import { MemoryKeyValue } from "../../platform/key-value.ts";
import { FakeLocks } from "../../platform/testing/fakes.ts";
import { nameFromText, nextAvailableName, parsePageName, sanitizePageName } from "./names.ts";
import { movePages } from "./open.ts";
import { OpfsPageStore } from "./opfs.ts";
import { revisionOf } from "./revision.ts";
import { pageStoreContract } from "./testing/contract.ts";
import { asDirectoryHandle, BROWSER_LIKE, FakeDirectoryHandle, FakeVolume } from "./testing/fake-opfs.ts";
import { isStoreError } from "./types.ts";

// Every backend passes the same contract. `tabs` gives the races two stores
// over one storage, standing for two tabs: with shared Web Locks where the
// backend awaits between its steps (OPFS), and without where it doesn't.
pageStoreContract("memory", async () => new MemoryPageStore(), {
  tabs: async () => {
    const store = new MemoryPageStore();
    return [store, store];
  },
});
const keyValue = (kv = new MemoryKeyValue(), locks: FakeLocks | null = null) =>
  new KeyValuePageStore(kv, { kind: "local-storage", durable: true, locks });
pageStoreContract("key-value (localStorage layout)", async () => keyValue(), {
  tabs: async () => {
    const kv = new MemoryKeyValue();
    return [keyValue(kv), keyValue(kv)];
  },
});
pageStoreContract("key-value with Web Locks", async () => keyValue(new MemoryKeyValue(), new FakeLocks()), {
  tabs: async () => {
    const kv = new MemoryKeyValue();
    const locks = new FakeLocks();
    return [keyValue(kv, locks), keyValue(kv, locks)];
  },
});
const opfs = (root: FakeDirectoryHandle, locks: FakeLocks | null = null) =>
  OpfsPageStore.open(asDirectoryHandle(root), { locks });
const opfsTabs = (volume: () => FakeVolume) => async () => {
  const root = new FakeDirectoryHandle("", volume());
  const locks = new FakeLocks();
  return [await opfs(root, locks), await opfs(root, locks)] as const;
};
pageStoreContract("OPFS (in-memory fake)", async () => opfs(new FakeDirectoryHandle()), {
  tabs: opfsTabs(() => new FakeVolume()),
});
pageStoreContract("OPFS with pages at the root (a served library's layout)", async () =>
  OpfsPageStore.open(asDirectoryHandle(new FakeDirectoryHandle()), { locks: null, appDir: null }),
);
pageStoreContract(
  "OPFS (fake listing in reverse, with stale snapshots)",
  async () =>
    opfs(new FakeDirectoryHandle("", new FakeVolume(Date.now, { listOrder: "reverse", staleSnapshots: true }))),
  { tabs: opfsTabs(() => new FakeVolume(Date.now, { listOrder: "reverse", staleSnapshots: true })) },
);
pageStoreContract(
  "OPFS (browser-like fake: names ignore case, reverse listing, stale snapshots)",
  async () => opfs(new FakeDirectoryHandle("", new FakeVolume(Date.now, BROWSER_LIKE))),
  { tabs: opfsTabs(() => new FakeVolume(Date.now, BROWSER_LIKE)) },
);

/** Two stores over one storage and one set of locks, standing for two tabs. */
function twoTabs() {
  const kv = new MemoryKeyValue();
  const locks = new FakeLocks();
  const tab = () => new KeyValuePageStore(kv, { kind: "local-storage", durable: true, locks });
  return { locks, a: tab(), b: tab() };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the localStorage backend writes a page only while holding its lock", async () => {
  const { locks, a, b } = twoTabs();
  await a.create(parsePageName("Brief"), "v1");
  let release = () => {};
  const held = locks.request("a4:page:brief", () => new Promise<void>((resolve) => (release = resolve)));
  const write = b.write(parsePageName("Brief"), "v2");
  await settle();
  assert.equal((await a.read(parsePageName("Brief"))).text, "v1");
  release();
  await held;
  await write;
  assert.equal((await a.read(parsePageName("Brief"))).text, "v2");
});

test("OPFS: an interrupted rename leaves the text under a listed name", async () => {
  const volume = new FakeVolume(Date.now, BROWSER_LIKE);
  const store = await opfs(new FakeDirectoryHandle("", volume));
  const texts = async () =>
    Object.fromEntries(
      await Promise.all((await store.list()).map(async (p) => [p.name, (await store.read(p.name)).text])),
    );

  // A rename that dies before deleting the source leaves the text under both names.
  await store.create(parsePageName("Notes"), "field notes");
  volume.failRemove = (name) => name === "Notes.md";
  await assert.rejects(store.rename(parsePageName("Notes"), parsePageName("Brief")));
  assert.deepEqual(await texts(), { Brief: "field notes", Notes: "field notes" });

  // A case-only rename that dies before deleting its temporary page leaves it listed too.
  volume.failRemove = null;
  await store.trash(parsePageName("Notes"));
  await store.rename(parsePageName("Brief"), parsePageName("brief"));
  volume.failRemove = (name) => name.endsWith("(renaming).md");
  await assert.rejects(store.rename(parsePageName("brief"), parsePageName("BRIEF")));
  assert.deepEqual(await texts(), { BRIEF: "field notes", "brief (renaming)": "field notes" });
});

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
