import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryKeyValue, MemoryPageStore } from "../store/key-value.ts";
import { parsePageName } from "../store/names.ts";
import type { PageStore, Revision, WriteResult } from "../store/types.ts";
import { ensureFirstPage, migrateLegacySlots, recoverDrafts, STALE_DRAFT_MS } from "./bootstrap.ts";
import { Journal } from "./journal.ts";
import { PageSession, type Scheduler, type SessionEvent } from "./session.ts";

const n = parsePageName;

/** Manual clock: timers fire only when `advance` passes their due time. */
class FakeScheduler implements Scheduler {
  now = 0;
  #id = 0;
  #timers = new Map<number, { at: number; fn: () => void }>();
  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.#id;
    this.#timers.set(id, { at: this.now + ms, fn });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.#timers.delete(handle as number);
  }
  async advance(ms: number): Promise<void> {
    const end = this.now + ms;
    for (;;) {
      const due = [...this.#timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.#timers.delete(due[0]);
      this.now = due[1].at;
      due[1].fn();
      await settle();
    }
    this.now = end;
    await settle();
  }
}

async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

/** Wraps a store to count writes and inject failures. */
class FlakyStore implements PageStore {
  readonly kind = "memory" as const;
  readonly durable = false;
  inner = new MemoryPageStore();
  writes = 0;
  failWrites = 0;
  list = () => this.inner.list();
  read = (name: Parameters<PageStore["read"]>[0]) => this.inner.read(name);
  create = (name: Parameters<PageStore["create"]>[0], text: string) => this.inner.create(name, text);
  rename = (a: Parameters<PageStore["rename"]>[0], b: Parameters<PageStore["rename"]>[1]) => this.inner.rename(a, b);
  trash = (name: Parameters<PageStore["trash"]>[0]) => this.inner.trash(name);
  listTrash = () => this.inner.listTrash();
  restore = (id: Parameters<PageStore["restore"]>[0]) => this.inner.restore(id);
  purge = (id: Parameters<PageStore["purge"]>[0]) => this.inner.purge(id);
  async write(name: Parameters<PageStore["write"]>[0], text: string, expected?: Revision | null): Promise<WriteResult> {
    this.writes++;
    if (this.failWrites > 0) {
      this.failWrites--;
      throw new Error("disk busy");
    }
    return this.inner.write(name, text, expected);
  }
}

async function setup(text = "start") {
  const store = new FlakyStore();
  const kv = new MemoryKeyValue();
  const journal = new Journal(kv, "tab1");
  const scheduler = new FakeScheduler();
  await store.create(n("Brief"), text);
  const events: SessionEvent[] = [];
  const session = new PageSession({
    store,
    journal,
    scheduler,
    page: await store.read(n("Brief")),
    onEvent: (e) => events.push(e),
  });
  const statuses = () => events.filter((e) => e.type === "status").map((e) => (e as { status: string }).status);
  return { store, kv, journal, scheduler, session, events, statuses };
}

test("every edit is journaled synchronously before any save", async () => {
  const { session, journal, store } = await setup();
  session.update("start, edited");
  assert.equal(journal.get(n("Brief"))?.text, "start, edited");
  assert.equal(store.writes, 0);
  assert.equal(session.status, "unsaved");
});

test("saves 600 ms after the last edit, then clears the journal", async () => {
  const { session, journal, store, scheduler, statuses } = await setup();
  session.update("a");
  await scheduler.advance(599);
  assert.equal(store.writes, 0);
  await scheduler.advance(1);
  assert.equal(store.writes, 1);
  assert.equal((await store.read(n("Brief"))).text, "a");
  assert.equal(journal.get(n("Brief")), null);
  assert.deepEqual(statuses(), ["unsaved", "saving", "saved"]);
});

test("continuous typing still saves at least every 4 s", async () => {
  const { session, store, scheduler } = await setup();
  for (let i = 0; i < 50; i++) {
    session.update(`typing ${i}`);
    await scheduler.advance(200); // never pauses for 600 ms
  }
  assert.ok(store.writes >= 2, `wrote ${store.writes} times in 10 s`);
});

test("flush saves immediately and waits for the latest text", async () => {
  const { session, store } = await setup();
  session.update("one");
  const first = session.flush();
  session.update("two"); // arrives while the first save is in flight
  await first;
  await session.flush();
  assert.equal((await store.read(n("Brief"))).text, "two");
  assert.equal(session.status, "saved");
});

test("failed saves retry with backoff and keep the journal", async () => {
  const { session, store, journal, scheduler, events } = await setup();
  store.failWrites = 2;
  session.update("important");
  await scheduler.advance(600);
  assert.equal(session.status, "error");
  assert.equal(journal.get(n("Brief"))?.text, "important");
  const retries = () => events.filter((e) => e.type === "error").map((e) => (e as { retryInMs: number }).retryInMs);
  assert.deepEqual(retries(), [1000]);
  await scheduler.advance(1000);
  assert.deepEqual(retries(), [1000, 2000]);
  await scheduler.advance(2000);
  assert.equal(session.status, "saved");
  assert.equal((await store.read(n("Brief"))).text, "important");
  assert.equal(journal.get(n("Brief")), null);
});

test("a conflict keeps both versions and follows the conflict copy", async () => {
  const { session, store, events } = await setup("v1");
  await store.inner.write(n("Brief"), "saved by tab 2");
  session.update("typed in tab 1");
  await session.flush();
  assert.equal((await store.read(n("Brief"))).text, "saved by tab 2");
  const conflict = events.find((e) => e.type === "conflict") as { original: string; copy: string } | undefined;
  assert.ok(conflict);
  assert.equal(conflict.original, "Brief");
  assert.match(conflict.copy, /^Brief \(conflict \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\)$/);
  assert.equal(session.name, conflict.copy);
  assert.equal((await store.read(n(conflict.copy))).text, "typed in tab 1");
  assert.equal(session.status, "saved");
});

test("a page deleted elsewhere is recreated from the unsaved text", async () => {
  const { session, store, events } = await setup();
  await store.trash(n("Brief"));
  session.update("keep this");
  await session.flush();
  const recreated = events.find((e) => e.type === "recreated") as { name: string } | undefined;
  assert.ok(recreated);
  assert.equal((await store.read(n(recreated.name))).text, "keep this");
});

test("adoptRemote takes another tab's save only when there are no unsaved edits", async () => {
  const { session, store } = await setup("v1");
  await store.inner.write(n("Brief"), "remote");
  assert.equal(session.adoptRemote(await store.read(n("Brief"))), true);
  assert.equal(session.text, "remote");
  session.update("local edit");
  await store.inner.write(n("Brief"), "remote 2");
  assert.equal(session.adoptRemote(await store.read(n("Brief"))), false);
  assert.equal(session.text, "local edit");
});

test("rename saves first and moves the page", async () => {
  const { session, store } = await setup();
  session.update("renamed text");
  await session.rename(n("Field brief"));
  assert.equal(session.name, "Field brief");
  assert.equal((await store.read(n("Field brief"))).text, "renamed text");
});

test("recovery applies a draft when the page is unchanged since it was based", async () => {
  const store = new MemoryPageStore();
  const kv = new MemoryKeyValue();
  const base = await store.create(n("Brief"), "saved");
  new Journal(kv, "dead-tab").set(n("Brief"), "unsaved edits", base.revision);
  const report = await recoverDrafts(store, new Journal(kv, "new-tab"), new Set());
  assert.deepEqual(report, [{ kind: "applied", page: "Brief", savedAs: "Brief" }]);
  assert.equal((await store.read(n("Brief"))).text, "unsaved edits");
  assert.equal(new Journal(kv, "x").all().length, 0);
});

test("recovery saves a copy when the page changed after the crash", async () => {
  const store = new MemoryPageStore();
  const kv = new MemoryKeyValue();
  const base = await store.create(n("Brief"), "saved");
  new Journal(kv, "dead-tab").set(n("Brief"), "crashed edits", base.revision);
  await store.write(n("Brief"), "changed later");
  const [r] = await recoverDrafts(store, new Journal(kv, "new-tab"), new Set());
  assert.equal(r.kind, "copied");
  assert.match(r.savedAs ?? "", /^Brief \(recovered /);
  assert.equal((await store.read(n(r.savedAs ?? ""))).text, "crashed edits");
  assert.equal((await store.read(n("Brief"))).text, "changed later");
});

test("recovery recreates a draft whose page is gone, and leaves live tabs alone", async () => {
  const store = new MemoryPageStore();
  const kv = new MemoryKeyValue();
  new Journal(kv, "dead-tab").set(n("Gone"), "orphan", null);
  new Journal(kv, "live-tab").set(n("Busy"), "still typing", null);
  const report = await recoverDrafts(store, new Journal(kv, "new-tab"), new Set(["live-tab"]));
  assert.deepEqual(report, [{ kind: "recreated", page: "Gone", savedAs: "Gone" }]);
  assert.equal((await store.read(n("Gone"))).text, "orphan");
  assert.equal(new Journal(kv, "live-tab").get(n("Busy"))?.text, "still typing");
});

test("without Web Locks, only stale drafts are recovered", async () => {
  const store = new MemoryPageStore();
  const kv = new MemoryKeyValue();
  new Journal(kv, "old", { now: () => 1_000 }).set(n("Old"), "old draft", null);
  new Journal(kv, "recent", { now: () => 1_000 + STALE_DRAFT_MS }).set(n("Recent"), "recent draft", null);
  const report = await recoverDrafts(store, new Journal(kv, "me"), null, 1_000 + STALE_DRAFT_MS + 10);
  assert.deepEqual(
    report.map((r) => r.page),
    ["Old"],
  );
});

test("legacy slots migrate once, named after their first line, skipping samples", async () => {
  const store = new MemoryPageStore();
  const kv = new MemoryKeyValue();
  kv.set("a4:text:a", "HANDOFF · Billing export\n\nWhere it stands.");
  kv.set("a4:text:b", "WELCOME TEXT");
  assert.deepEqual(await migrateLegacySlots(store, kv, ["WELCOME TEXT"]), ["HANDOFF · Billing export"]);
  assert.equal((await store.read(n("HANDOFF · Billing export"))).text, "HANDOFF · Billing export\n\nWhere it stands.");
  assert.equal(kv.get("a4:text:a"), "HANDOFF · Billing export\n\nWhere it stands.");
  assert.deepEqual(await migrateLegacySlots(store, kv, []), []);
});

test("an empty library gets a Welcome page; a non-empty one does not", async () => {
  const store = new MemoryPageStore();
  assert.equal(await ensureFirstPage(store, "hello"), "Welcome");
  assert.equal((await store.read(n("Welcome"))).text, "hello");
  assert.equal(await ensureFirstPage(store, "hello"), null);
});
