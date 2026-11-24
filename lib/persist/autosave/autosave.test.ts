import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryPageStore } from "../store/key-value.ts";
import { MemoryKeyValue } from "../../platform/key-value.ts";
import { pageNameCodec, parsePageName } from "../store/names.ts";
import type { PageStore, Revision, WriteResult } from "../store/types.ts";
import { ensureFirstPage, migrateLegacySlots, recoverDrafts, STALE_DRAFT_MS } from "./bootstrap.ts";
import { Journal } from "./journal.ts";
import { createFileSession, createLibrarySession, type SessionEvent } from "./session.ts";
import { FakeScheduler } from "./testing/fake-scheduler.ts";
import { sheetFiles } from "../folder/faithful.ts";
import { fileCopyName, filePathCodec, parseFilePath, type FilePath } from "../store/refs.ts";
import { FolderPageFiles } from "../store/folder.ts";
import { asDirectoryHandle, FakeDirectoryHandle } from "../store/testing/fake-opfs.ts";
import { browserFolderSource } from "../folder/fs-browser.ts";

const n = parsePageName;

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
  const journal = new Journal(kv, "tab1", pageNameCodec);
  const scheduler = new FakeScheduler();
  await store.create(n("Brief"), text);
  const events: SessionEvent[] = [];
  const session = createLibrarySession(store, journal, await store.read(n("Brief")), {
    scheduler,
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
  new Journal(kv, "dead-tab", pageNameCodec).set(n("Brief"), "unsaved edits", base.revision);
  const report = await recoverDrafts(
    store,
    new Journal(kv, "new-tab", pageNameCodec),
    { kind: "same-store", store },
    new Set(),
  );
  assert.deepEqual(report, [{ kind: "applied", page: "Brief" }]);
  assert.equal((await store.read(n("Brief"))).text, "unsaved edits");
  assert.equal(new Journal(kv, "x", pageNameCodec).all().length, 0);
});

test("recovery saves a copy when the page changed after the crash", async () => {
  const store = new MemoryPageStore();
  const kv = new MemoryKeyValue();
  const base = await store.create(n("Brief"), "saved");
  new Journal(kv, "dead-tab", pageNameCodec).set(n("Brief"), "crashed edits", base.revision);
  await store.write(n("Brief"), "changed later");
  const [r] = await recoverDrafts(
    store,
    new Journal(kv, "new-tab", pageNameCodec),
    { kind: "same-store", store },
    new Set(),
  );
  assert.ok(r?.kind === "copied");
  assert.match(r.savedAs, /^Brief \(recovered /);
  assert.equal((await store.read(r.savedAs)).text, "crashed edits");
  assert.equal((await store.read(n("Brief"))).text, "changed later");
});

test("recovery recreates a draft whose page is gone, and leaves live tabs alone", async () => {
  const store = new MemoryPageStore();
  const kv = new MemoryKeyValue();
  new Journal(kv, "dead-tab", pageNameCodec).set(n("Gone"), "orphan", null);
  new Journal(kv, "live-tab", pageNameCodec).set(n("Busy"), "still typing", null);
  const report = await recoverDrafts(
    store,
    new Journal(kv, "new-tab", pageNameCodec),
    { kind: "same-store", store },
    new Set(["live-tab"]),
  );
  assert.deepEqual(report, [{ kind: "recreated", page: "Gone", savedAs: "Gone" }]);
  assert.equal((await store.read(n("Gone"))).text, "orphan");
  assert.equal(new Journal(kv, "live-tab", pageNameCodec).get(n("Busy"))?.text, "still typing");
});

test("without Web Locks, only stale drafts are recovered", async () => {
  const store = new MemoryPageStore();
  const kv = new MemoryKeyValue();
  new Journal(kv, "old", pageNameCodec, { clock: { now: () => 1_000 } }).set(n("Old"), "old draft", null);
  new Journal(kv, "recent", pageNameCodec, { clock: { now: () => 1_000 + STALE_DRAFT_MS } }).set(
    n("Recent"),
    "recent draft",
    null,
  );
  const report = await recoverDrafts(
    store,
    new Journal(kv, "me", pageNameCodec),
    { kind: "same-store", store },
    null,
    1_000 + STALE_DRAFT_MS + 10,
  );
  assert.deepEqual(
    report.map((r) => r.page),
    ["Old"],
  );
});

test("the journal skips keys that don't parse and ignores a corrupt base", () => {
  const kv = new MemoryKeyValue();
  const files = new Journal(kv, "tab1", filePathCodec, { prefix: "a4:folder:f1:" });
  files.set(parseFilePath("AGENTS.md"), "kept", null);
  kv.set("a4:folder:f1:draft:tab1:../outside.md", "stale");
  kv.set("a4:folder:f1:draft-base:tab1:AGENTS.md", "garbage");
  const drafts = files.all();
  assert.deepEqual(
    drafts.map((d) => [d.name, d.text, d.base]),
    [["AGENTS.md", "kept", null]],
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

// ---------------------------------------------------------------------------
// Folder files: copies go to the library, and files are never recreated.

async function folderSetup(raw = "# Agents\r\n\tRule one\r\n") {
  const root = new FakeDirectoryHandle("a4");
  root.put("AGENTS.md", raw);
  const files = sheetFiles(
    new FolderPageFiles(browserFolderSource.open(asDirectoryHandle(root)), { id: "f1", locks: null }),
  );
  const library = new MemoryPageStore();
  const kv = new MemoryKeyValue();
  const journal = new Journal(kv, "tab1", filePathCodec, { prefix: "a4:folder:f1:" });
  const scheduler = new FakeScheduler();
  const events: SessionEvent<FilePath>[] = [];
  const path = parseFilePath("AGENTS.md");
  const session = createFileSession(
    files,
    journal,
    await files.read(path),
    { library, libraryJournal: new Journal(kv, "tab1", pageNameCodec), copyName: fileCopyName },
    { scheduler, onEvent: (e) => events.push(e) },
  );
  return { root, files, library, kv, journal, scheduler, events, path, session };
}

test("a folder file saves faithfully through the session", async () => {
  const { root, session, scheduler } = await folderSetup();
  assert.equal(session.text, "# Agents\n  Rule one");
  session.update("# Agents\n  Rule one\nRule two");
  await scheduler.advance(600);
  assert.equal(root.fileAt("AGENTS.md")!.text, "# Agents\r\n\tRule one\r\nRule two\r\n");
  assert.equal(session.status, "saved");
});

test("a conflict on a folder file makes a library copy and leaves the file unchanged", async () => {
  const { root, session, library, events, journal, path } = await folderSetup();
  root.fileAt("AGENTS.md")!.setContent("checked out\n");
  session.update("typed in A4");
  await session.flush();
  assert.equal(root.fileAt("AGENTS.md")!.text, "checked out\n");
  const conflict = events.find((e) => e.type === "conflict") as { copy: string; moved: boolean; original: string };
  assert.ok(conflict);
  assert.equal(conflict.original, "AGENTS.md");
  assert.equal(conflict.moved, true);
  assert.match(conflict.copy, /^AGENTS\.md \(conflict \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\)$/);
  assert.equal((await library.read(n(conflict.copy))).text, "typed in A4");
  assert.equal(session.stopped, true);
  assert.equal(journal.get(path), null);
  assert.equal(root.children.size, 1);
});

test("a folder file deleted on disk is not recreated; its text goes to the library", async () => {
  const { root, session, library, events } = await folderSetup();
  root.remove("AGENTS.md");
  session.update("keep this");
  await session.flush();
  assert.equal(root.fileAt("AGENTS.md"), undefined);
  const recreated = events.find((e) => e.type === "recreated") as { name: string; moved: boolean };
  assert.ok(recreated);
  assert.equal(recreated.moved, true);
  assert.match(recreated.name, /^AGENTS\.md \(recovered /);
  assert.equal((await library.read(n(recreated.name))).text, "keep this");
});

test("a crashed folder draft is written to the file when the file is unchanged", async () => {
  const { root, files, library, kv, path } = await folderSetup("v1\n");
  const page = await files.read(path);
  new Journal(kv, "dead-tab", filePathCodec, { prefix: "a4:folder:f1:" }).set(path, "v1\nunsaved", page.revision);
  const report = await recoverDrafts(
    files,
    new Journal(kv, "new-tab", filePathCodec, { prefix: "a4:folder:f1:" }),
    { kind: "copy-out", library, libraryJournal: new Journal(kv, "new-tab", pageNameCodec), copyName: fileCopyName },
    new Set(),
  );
  assert.deepEqual(report, [{ kind: "applied", page: "AGENTS.md" }]);
  assert.equal(root.fileAt("AGENTS.md")!.text, "v1\nunsaved\n");
  assert.deepEqual(await library.list(), []);
});

test("a crashed folder draft becomes a library copy when the file changed", async () => {
  const { root, files, library, kv, path } = await folderSetup("v1\n");
  const page = await files.read(path);
  new Journal(kv, "dead-tab", filePathCodec, { prefix: "a4:folder:f1:" }).set(path, "crashed edits", page.revision);
  root.fileAt("AGENTS.md")!.setContent("changed later\n");
  const [r] = await recoverDrafts(
    files,
    new Journal(kv, "new-tab", filePathCodec, { prefix: "a4:folder:f1:" }),
    { kind: "copy-out", library, libraryJournal: new Journal(kv, "new-tab", pageNameCodec), copyName: fileCopyName },
    new Set(),
  );
  assert.ok(r?.kind === "copied");
  assert.match(r.savedAs, /^AGENTS\.md \(recovered /);
  assert.equal((await library.read(r.savedAs)).text, "crashed edits");
  assert.equal(root.fileAt("AGENTS.md")!.text, "changed later\n");
});

test("a crashed draft of a deleted folder file goes to the library, not the folder", async () => {
  const { root, files, library, kv, path } = await folderSetup("v1\n");
  new Journal(kv, "dead-tab", filePathCodec, { prefix: "a4:folder:f1:" }).set(path, "orphan", null);
  root.remove("AGENTS.md");
  const [r] = await recoverDrafts(
    files,
    new Journal(kv, "new-tab", filePathCodec, { prefix: "a4:folder:f1:" }),
    { kind: "copy-out", library, libraryJournal: new Journal(kv, "new-tab", pageNameCodec), copyName: fileCopyName },
    new Set(),
  );
  assert.ok(r?.kind === "recreated");
  assert.equal(root.fileAt("AGENTS.md"), undefined);
  assert.equal((await library.read(r.savedAs)).text, "orphan");
});

test("text the store refuses is reported once, not retried", async () => {
  const { session, store, scheduler, events } = await setup("v1");
  session.update("bad \uD800 text");
  await scheduler.advance(60_000);
  const errors = events.filter((e) => e.type === "error") as { retryInMs: number | null }[];
  assert.equal(errors.length, 1);
  assert.equal(errors[0].retryInMs, null);
  assert.equal(session.status, "error");
  assert.equal((await store.read(n("Brief"))).text, "v1");
  // The next edit makes the text storable again and saves it.
  session.update("good text");
  await scheduler.advance(600);
  assert.equal((await store.read(n("Brief"))).text, "good text");
});

test("keys typed while a folder file's text is copied to the library are kept", async () => {
  const root = new FakeDirectoryHandle("a4");
  root.put("AGENTS.md", "v1\n");
  const files = sheetFiles(
    new FolderPageFiles(browserFolderSource.open(asDirectoryHandle(root)), { id: "f1", locks: null }),
  );
  const library = new MemoryPageStore();
  let release: () => void = () => {};
  const create = library.create.bind(library);
  library.create = async (name, text) => {
    await new Promise<void>((r) => (release = r));
    return create(name, text);
  };
  const kv = new MemoryKeyValue();
  const libraryJournal = new Journal(kv, "tab1", pageNameCodec);
  const events: SessionEvent<FilePath>[] = [];
  const session = createFileSession(
    files,
    new Journal(kv, "tab1", filePathCodec, { prefix: "a4:folder:f1:" }),
    await files.read(parseFilePath("AGENTS.md")),
    { library, libraryJournal, copyName: fileCopyName },
    { scheduler: new FakeScheduler(), onEvent: (e) => events.push(e) },
  );
  root.fileAt("AGENTS.md")!.setContent("checked out\n");
  session.update("mine");
  const flushing = session.flush();
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  session.update("mine, and more typed during the copy");
  release();
  await flushing;
  const moved = events.find((e) => e.type === "conflict") as { copy: string; pendingText?: string };
  assert.equal(moved.pendingText, "mine, and more typed during the copy");
  // The copy holds the first text; the later keys are journaled under the copy.
  const copy = await library.read(n(moved.copy));
  assert.equal(copy.text, "mine");
  assert.equal(libraryJournal.get(n(moved.copy))?.text, "mine, and more typed during the copy");
  // Opening the copy in this tab resumes that draft and saves it.
  const scheduler = new FakeScheduler();
  const reopened = createLibrarySession(library, libraryJournal, copy, { scheduler });
  assert.equal(reopened.text, "mine, and more typed during the copy");
  await scheduler.advance(0);
  assert.equal((await library.read(n(moved.copy))).text, "mine, and more typed during the copy");
  assert.equal(libraryJournal.get(n(moved.copy)), null);
});

test("a draft left by a failed save in this tab is resumed when the page is reopened", async () => {
  const { session, store, journal, scheduler } = await setup("v1");
  store.failWrites = 100;
  session.update("typed, never saved");
  await scheduler.advance(600);
  assert.equal(session.status, "error");
  await session.dispose();
  store.failWrites = 0;
  // Reopening in the same tab shows the draft, not the stored text, and saves it.
  const again = createLibrarySession(store, journal, await store.read(n("Brief")), { scheduler });
  assert.equal(again.text, "typed, never saved");
  assert.equal(again.status, "unsaved");
  await scheduler.advance(0);
  assert.equal((await store.read(n("Brief"))).text, "typed, never saved");
  assert.equal(journal.get(n("Brief")), null);
});

test("a resumed draft whose page changed since becomes a conflict copy", async () => {
  const { session, store, journal, scheduler } = await setup("v1");
  store.failWrites = 100;
  session.update("my draft");
  await scheduler.advance(600);
  await session.dispose();
  store.failWrites = 0;
  await store.inner.write(n("Brief"), "changed in another tab");
  const events: SessionEvent[] = [];
  const again = createLibrarySession(store, journal, await store.read(n("Brief")), {
    scheduler,
    onEvent: (e) => events.push(e),
  });
  await scheduler.advance(0);
  assert.equal((await store.read(n("Brief"))).text, "changed in another tab");
  const conflict = events.find((e) => e.type === "conflict") as { copy: string };
  assert.ok(conflict);
  assert.equal((await store.read(n(conflict.copy))).text, "my draft");
  assert.equal(again.name, conflict.copy);
});
