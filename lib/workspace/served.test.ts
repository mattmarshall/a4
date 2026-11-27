import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeScheduler, settle } from "../persist/autosave/testing/fake-scheduler.ts";
import { browserFolderSource } from "../persist/folder/fs-browser.ts";
import { MemoryHandleStore } from "../platform/handle-store.ts";
import { MemoryKeyValue } from "../platform/key-value.ts";
import { ChannelHub, fakePlatform, FakeTabs } from "../platform/testing/fakes.ts";
import { Journal } from "../persist/autosave/journal.ts";
import { libraryRef } from "../persist/store/refs.ts";
import { readSetting, SETTINGS, writeSetting } from "../persist/settings.ts";
import { MemoryPageStore } from "../persist/store/key-value.ts";
import { pageNameCodec, parsePageName } from "../persist/store/names.ts";
import type { ServedStore } from "../persist/store/remote.ts";
import type { ServedConnection } from "../persist/store/served.ts";
import {
  type PageName,
  type Revision,
  StoreUnavailableError,
  type TrashId,
  type UnavailableReason,
} from "../persist/store/types.ts";
import type { WorkspaceNotice } from "./types.ts";
import { Workspace } from "./workspace.ts";

const n = parsePageName;
const TOKEN = "t".repeat(43);
const SERVED: ServedConnection = { address: "127.0.0.1:4320", token: TOKEN };
const NOTES = "NotesNotesNotesNotes_1";
const OTHER = "OtherOtherOtherOther_2";

/**
 * A memory store standing in for `a4 serve` over one library folder: it can
 * be stopped, or answer as another protocol version, and it counts listings
 * and page operations.
 */
class ServedStandIn implements ServedStore {
  readonly kind = "served" as const;
  readonly durable = true;
  readonly pages = new MemoryPageStore();
  readonly id: string;
  down = false;
  /** Answer GetLibrary as a server that can't be used for this reason. */
  refusal: UnavailableReason | null = null;
  listings = 0;
  /** Page operations: anything but GetLibrary. */
  operations = 0;

  constructor(id = NOTES) {
    this.id = id;
  }

  #up(): void {
    if (this.down) throw new StoreUnavailableError("a4 serve isn’t running at 127.0.0.1:4320.", "not-running");
    this.operations++;
  }
  async library() {
    if (this.down) throw new StoreUnavailableError("a4 serve isn’t running at 127.0.0.1:4320.", "not-running");
    if (this.refusal) throw new StoreUnavailableError("a4 serve at 127.0.0.1:4320 can’t be used.", this.refusal);
    return this.id;
  }
  async list() {
    this.#up();
    this.listings++;
    return this.pages.list();
  }
  async read(name: PageName) {
    this.#up();
    return this.pages.read(name);
  }
  async create(name: PageName, text: string) {
    this.#up();
    return this.pages.create(name, text);
  }
  async createUnique(desired: string, text: string) {
    this.#up();
    return this.pages.createUnique(desired, text);
  }
  async write(name: PageName, text: string, expected?: Revision | null) {
    this.#up();
    return this.pages.write(name, text, expected);
  }
  async rename(from: PageName, to: PageName) {
    this.#up();
    return this.pages.rename(from, to);
  }
  async trash(name: PageName) {
    this.#up();
    return this.pages.trash(name);
  }
  async listTrash() {
    this.#up();
    return this.pages.listTrash();
  }
  async restore(id: TrashId) {
    this.#up();
    return this.pages.restore(id);
  }
  async purge(id: TrashId) {
    this.#up();
    return this.pages.purge(id);
  }
}

/** One browser with its own library, and a served library on this machine. */
function setup() {
  const scheduler = new FakeScheduler();
  const keyValue = new MemoryKeyValue();
  const hub = new ChannelHub();
  const tabs = new FakeTabs();
  const handles = new MemoryHandleStore<FileSystemDirectoryHandle>();
  const store = new MemoryPageStore();
  const served = new ServedStandIn();
  /** The folder `a4 serve` serves at 127.0.0.1:4320 right now. */
  let serving = served;
  let visible = true;
  const open = () => {
    const platform = fakePlatform({ scheduler, keyValue, hub, tabs });
    const notices: WorkspaceNotice[] = [];
    const workspace = new Workspace({
      platform,
      folders: { source: browserFolderSource, handles },
      welcomeText: "Welcome to A4",
      skipMigration: [],
      openStore: async () => ({ store, movedFromFallback: 0 }),
      openServed: () => serving,
      scheduler,
      isVisible: () => visible,
    });
    workspace.subscribeNotices((notice) => notices.push(notice));
    return { workspace, notices };
  };
  return {
    scheduler,
    keyValue,
    store,
    served,
    tabs,
    open,
    /** Serve another folder at the same address. */
    serve: (folder: ServedStandIn) => {
      serving = folder;
    },
    hide: (hidden: boolean) => {
      visible = !hidden;
    },
  };
}

const names = (w: Workspace<unknown>) =>
  w
    .getSnapshot()
    .library.pages.map((p) => p.name)
    .sort();

test("connecting shows the served pages; switching back reopens this browser's pages as they were", async () => {
  const s = setup();
  await s.served.pages.create(n("Brief"), "served brief");
  const { workspace } = s.open();
  await workspace.start();
  await workspace.createPage("Notes", "my notes", "a");
  assert.equal(workspace.getSnapshot().served, null);

  assert.ok((await workspace.connectServed(SERVED)).ok);
  let snapshot = workspace.getSnapshot();
  assert.deepEqual(snapshot.served, { address: "127.0.0.1:4320", shown: true });
  assert.equal(snapshot.storage?.kind, "served");
  assert.deepEqual(names(workspace), ["Brief"]);
  assert.equal(snapshot.slots.a.name, "Brief");
  assert.equal(snapshot.slots.a.text, "served brief");
  // Library actions work against the served library.
  await workspace.createPage("Plan", "served plan", "a");
  assert.equal((await s.served.pages.read(n("Plan"))).text, "served plan");

  assert.ok((await workspace.switchLibrary("browser")).ok);
  snapshot = workspace.getSnapshot();
  assert.deepEqual(snapshot.served, { address: "127.0.0.1:4320", shown: false });
  assert.deepEqual(names(workspace), ["Notes", "Welcome"]);
  assert.equal(snapshot.slots.a.name, "Notes");
  assert.equal(snapshot.slots.a.text, "my notes");
  assert.ok(!(await s.store.list()).some((p) => p.name === "Plan"), "nothing served reached this browser's library");

  // And the served library remembers its own open page.
  assert.ok((await workspace.switchLibrary("served")).ok);
  assert.equal(workspace.getSnapshot().slots.a.name, "Plan");
  await workspace.dispose();
});

test("an empty served folder starts with an Untitled page", async () => {
  const s = setup();
  const { workspace } = s.open();
  await workspace.start();
  await workspace.connectServed(SERVED);
  assert.deepEqual(names(workspace), ["Untitled"]);
  assert.equal(workspace.getSnapshot().slots.a.name, "Untitled");
  await workspace.dispose();
});

test("a draft typed on the served library while it's stopped is recovered there, and only there", async () => {
  const s = setup();
  await s.served.pages.create(n("Brief"), "v1");
  const { workspace, notices } = s.open();
  await workspace.start();
  await workspace.connectServed(SERVED);
  s.served.down = true;
  workspace.edit("a", "v2, typed while the server was stopped");
  assert.ok(
    s.keyValue.keys().some((k) => k.startsWith(`a4:served:${NOTES}:draft:`)),
    "journaled under the library's id",
  );
  assert.ok(!s.keyValue.keys().some((k) => k.startsWith("a4:draft:") && k.endsWith(":Brief")));

  assert.ok((await workspace.switchLibrary("browser")).ok);
  assert.deepEqual(names(workspace), ["Welcome"]);
  assert.equal(workspace.getSnapshot().slots.a.name, "Welcome");
  assert.equal((await s.served.pages.read(n("Brief"))).text, "v1");

  s.served.down = false;
  assert.ok((await workspace.switchLibrary("served")).ok);
  assert.equal((await s.served.pages.read(n("Brief"))).text, "v2, typed while the server was stopped");
  assert.equal(workspace.getSnapshot().slots.a.text, "v2, typed while the server was stopped");
  assert.ok(notices.some((x) => x.kind === "recovered-library"));
  assert.deepEqual(
    (await s.store.list()).map((p) => p.name),
    ["Welcome"],
    "this browser's library is untouched",
  );
  await workspace.dispose();
});

test("a served library that can't be reached leaves this browser's library in place, with a notice", async () => {
  const s = setup();
  s.served.down = true;
  const { workspace, notices } = s.open();
  await workspace.start();
  workspace.edit("a", "Welcome, edited");
  assert.ok((await workspace.connectServed(SERVED)).ok);
  const snapshot = workspace.getSnapshot();
  assert.deepEqual(snapshot.served, { address: "127.0.0.1:4320", shown: false });
  assert.equal(snapshot.storage?.kind, "memory");
  assert.equal(snapshot.slots.a.name, "Welcome");
  assert.equal(snapshot.slots.a.text, "Welcome, edited", "nothing was closed");
  const notice = notices.find((x) => x.kind === "served-unreachable");
  assert.ok(notice && notice.kind === "served-unreachable" && notice.address === "127.0.0.1:4320");
  assert.equal(notice.reason, "not-running");
  // The connection is remembered, so switching works once the server runs.
  s.served.down = false;
  assert.ok((await workspace.switchLibrary("served")).ok);
  assert.equal(workspace.getSnapshot().served?.shown, true);
  await workspace.dispose();
});

test("startup reopens the served library last used, or falls back with a notice when it's stopped", async () => {
  const s = setup();
  await s.served.pages.create(n("Brief"), "served brief");
  const first = s.open();
  await first.workspace.start();
  await first.workspace.connectServed(SERVED);
  await first.workspace.dispose();

  const second = s.open();
  await second.workspace.start();
  assert.equal(second.workspace.getSnapshot().served?.shown, true);
  assert.equal(second.workspace.getSnapshot().slots.a.name, "Brief");
  await second.workspace.dispose();

  s.served.down = true;
  const third = s.open();
  await third.workspace.start();
  const snapshot = third.workspace.getSnapshot();
  assert.equal(snapshot.status.kind, "ready");
  assert.equal(snapshot.served?.shown, false);
  assert.equal(snapshot.slots.a.name, "Welcome");
  assert.ok(third.notices.some((x) => x.kind === "served-unreachable"));
  await third.workspace.dispose();
});

test("Disconnect forgets the served library and shows this browser's; a reload stays there", async () => {
  const s = setup();
  await s.served.pages.create(n("Brief"), "served brief");
  const { workspace } = s.open();
  await workspace.start();
  await workspace.connectServed(SERVED);
  assert.ok((await workspace.disconnectServed()).ok);
  assert.equal(workspace.getSnapshot().served, null);
  assert.equal(workspace.getSnapshot().slots.a.name, "Welcome");
  assert.equal(readSetting(SETTINGS.servedLibrary), null);
  assert.equal((await s.served.pages.read(n("Brief"))).text, "served brief", "the served files are untouched");
  await workspace.dispose();
  const again = s.open();
  await again.workspace.start();
  assert.equal(again.workspace.getSnapshot().served, null);
  assert.equal(again.workspace.getSnapshot().storage?.kind, "memory");
  await again.workspace.dispose();
});

test("changes on disk show up within 5 seconds: new pages, and new text where nothing is unsaved", async () => {
  const s = setup();
  await s.served.pages.create(n("Brief"), "v1");
  const { workspace } = s.open();
  await workspace.start();
  await workspace.connectServed(SERVED);
  await s.served.pages.create(n("Agent notes"), "written by an agent");
  const brief = await s.served.pages.read(n("Brief"));
  await s.served.pages.write(n("Brief"), "v2, written by an agent", brief.revision);
  await s.scheduler.advance(5000);
  assert.deepEqual(names(workspace), ["Agent notes", "Brief"]);
  assert.equal(workspace.getSnapshot().slots.a.text, "v2, written by an agent");
  await workspace.dispose();
});

test("a page with unsaved edits keeps both versions when an agent changes it", async () => {
  const s = setup();
  await s.served.pages.create(n("Brief"), "v1");
  const { workspace, notices } = s.open();
  await workspace.start();
  await workspace.connectServed(SERVED);
  workspace.edit("a", "v1 and my edit");
  const brief = await s.served.pages.read(n("Brief"));
  await s.served.pages.write(n("Brief"), "v2 from the agent", brief.revision);
  await s.scheduler.advance(5000);
  await settle();
  const texts = await Promise.all(
    (await s.served.pages.list()).map(async (p) => (await s.served.pages.read(p.name)).text),
  );
  assert.ok(texts.includes("v2 from the agent"));
  assert.ok(texts.includes("v1 and my edit"));
  assert.ok(notices.some((x) => x.kind === "conflict"));
  await workspace.dispose();
});

test("nothing polls while the tab is hidden, or on this browser's library", async () => {
  const s = setup();
  await s.served.pages.create(n("Brief"), "v1");
  const { workspace } = s.open();
  await workspace.start();
  await workspace.connectServed(SERVED);
  s.hide(true);
  const before = s.served.listings;
  await s.scheduler.advance(10_000);
  assert.equal(s.served.listings, before);
  s.hide(false);
  await s.scheduler.advance(2000);
  assert.ok(s.served.listings > before);
  await workspace.switchLibrary("browser");
  const after = s.served.listings;
  await s.scheduler.advance(10_000);
  assert.equal(s.served.listings, after);
  await workspace.dispose();
});

test("a draft stays with its library: another folder on the same port doesn't get it", async () => {
  const s = setup();
  await s.served.pages.create(n("Brief"), "notes v1");
  const other = new ServedStandIn(OTHER);
  await other.pages.create(n("Brief"), "other's brief");
  const { workspace } = s.open();
  await workspace.start();
  await workspace.connectServed(SERVED);
  s.served.down = true;
  workspace.edit("a", "notes v2, unsaved");
  assert.ok((await workspace.switchLibrary("browser")).ok);

  // Another folder is served at the same address: the draft isn't its.
  s.serve(other);
  assert.ok((await workspace.switchLibrary("served")).ok);
  assert.equal(workspace.getSnapshot().served?.shown, true);
  assert.equal((await other.pages.read(n("Brief"))).text, "other's brief");
  assert.deepEqual(
    (await other.pages.list()).map((p) => p.name),
    ["Brief"],
  );

  // The first folder, served again, gets its draft back.
  s.served.down = false;
  s.serve(s.served);
  assert.ok((await workspace.switchLibrary("browser")).ok);
  assert.ok((await workspace.switchLibrary("served")).ok);
  assert.equal((await s.served.pages.read(n("Brief"))).text, "notes v2, unsaved");
  await workspace.dispose();
});

test("open pages come back per library", async () => {
  const s = setup();
  await s.served.pages.create(n("Brief"), "notes brief");
  await s.served.pages.create(n("Plan"), "notes plan");
  const other = new ServedStandIn(OTHER);
  await other.pages.create(n("Ideas"), "other's ideas");
  const { workspace } = s.open();
  await workspace.start();
  await workspace.connectServed(SERVED);
  await workspace.open("a", libraryRef(n("Plan")));
  assert.ok((await workspace.switchLibrary("browser")).ok);

  s.serve(other);
  assert.ok((await workspace.switchLibrary("served")).ok);
  assert.equal(workspace.getSnapshot().slots.a.name, "Ideas");
  assert.ok((await workspace.switchLibrary("browser")).ok);

  s.serve(s.served);
  assert.ok((await workspace.switchLibrary("served")).ok);
  assert.equal(workspace.getSnapshot().slots.a.name, "Plan");
  // Disconnecting forgets the connection, not the library's open pages.
  assert.ok((await workspace.disconnectServed()).ok);
  assert.ok((await workspace.connectServed(SERVED)).ok);
  assert.equal(workspace.getSnapshot().slots.a.name, "Plan");
  await workspace.dispose();
});

test("a server of another version is refused with its reason, and gets no page operation", async () => {
  for (const reason of ["older-server", "newer-server"] as const) {
    const s = setup();
    await s.served.pages.create(n("Brief"), "served brief");
    s.served.refusal = reason;
    const { workspace, notices } = s.open();
    await workspace.start();
    workspace.edit("a", "Welcome, edited");
    assert.ok((await workspace.connectServed(SERVED)).ok);
    const snapshot = workspace.getSnapshot();
    assert.equal(snapshot.served?.shown, false);
    assert.equal(snapshot.storage?.kind, "memory");
    assert.equal(snapshot.slots.a.text, "Welcome, edited", "nothing was closed");
    const notice = notices.find((x) => x.kind === "served-unreachable");
    assert.ok(notice?.kind === "served-unreachable");
    assert.equal(notice.reason, reason);
    assert.equal(s.served.operations, 0, `the ${reason} received no page operation`);
    await workspace.dispose();
  }
});

test("what was kept by address is adopted once by the first library reached there", async () => {
  const s = setup();
  await s.served.pages.create(n("Brief"), "brief v1");
  await s.served.pages.create(n("Plan"), "plan v1");
  const briefBase = (await s.served.pages.read(n("Brief"))).revision;
  const planBase = (await s.served.pages.read(n("Plan"))).revision;
  await s.served.pages.write(n("Plan"), "plan v2, changed since the draft", planBase);
  const { workspace, notices } = s.open();
  await workspace.start();

  // Before libraries had ids: drafts from a tab that's gone, kept by address, and one pair of open-page keys.
  const old = new Journal(s.keyValue, "a-closed-tab", pageNameCodec, { prefix: "a4:served:127.0.0.1:4320:" });
  old.set(n("Brief"), "brief v1, then a draft", briefBase);
  old.set(n("Plan"), "plan v1, then a draft", planBase);
  writeSetting(SETTINGS.servedOpenA, libraryRef(n("Plan")));

  assert.ok((await workspace.connectServed(SERVED)).ok);
  // The unchanged page gets its draft; the changed one keeps its text, and the draft is saved beside it.
  assert.equal((await s.served.pages.read(n("Brief"))).text, "brief v1, then a draft");
  assert.equal((await s.served.pages.read(n("Plan"))).text, "plan v2, changed since the draft");
  const copies = (await s.served.pages.list()).filter((p) => p.name.startsWith("Plan (recovered"));
  assert.equal(copies.length, 1);
  assert.equal((await s.served.pages.read(copies[0]?.name ?? n("missing"))).text, "plan v1, then a draft");
  assert.ok(notices.some((x) => x.kind === "recovered-library"));
  // The open page moved to the library's id, and nothing is kept by address any more.
  assert.equal(workspace.getSnapshot().slots.a.name, "Plan");
  assert.equal(readSetting(SETTINGS.servedOpenA), null);
  assert.ok(!s.keyValue.keys().some((k) => k.startsWith("a4:served:127.0.0.1:4320:")));

  // A second reach adopts nothing.
  const pages = (await s.served.pages.list()).length;
  const recovered = notices.filter((x) => x.kind === "recovered-library").length;
  assert.ok((await workspace.switchLibrary("browser")).ok);
  assert.ok((await workspace.switchLibrary("served")).ok);
  assert.equal((await s.served.pages.list()).length, pages);
  assert.equal(notices.filter((x) => x.kind === "recovered-library").length, recovered);
  await workspace.dispose();
});

test("the Connect form remembers nothing when a4 serve isn't running, and says why without a notice", async () => {
  const s = setup();
  s.served.down = true;
  const { workspace, notices } = s.open();
  await workspace.start();
  workspace.edit("a", "Welcome, edited");
  const result = await workspace.connectServed(SERVED, "form");
  assert.ok(result.ok);
  assert.deepEqual(result.value, {
    connected: false,
    reason: "not-running",
    message: "a4 serve isn’t running at 127.0.0.1:4320.",
  });
  const snapshot = workspace.getSnapshot();
  assert.equal(snapshot.served, null, "the switch isn't offered");
  assert.equal(snapshot.storage?.kind, "memory", "this browser's library is still shown");
  assert.equal(snapshot.slots.a.text, "Welcome, edited", "nothing was closed");
  assert.equal(
    notices.some((x) => x.kind === "served-unreachable"),
    false,
  );
  assert.equal(s.served.operations, 0);
  await workspace.dispose();
  // After a reload, Connect is still what the Pages panel offers.
  const reloaded = s.open();
  await reloaded.workspace.start();
  assert.equal(reloaded.workspace.getSnapshot().served, null);
  await reloaded.workspace.dispose();
});

test("the Connect form remembers nothing when a4 serve refuses the token", async () => {
  const s = setup();
  s.served.refusal = "refused";
  const { workspace } = s.open();
  await workspace.start();
  const result = await workspace.connectServed(SERVED, "form");
  assert.ok(result.ok && !result.value.connected && result.value.reason === "refused");
  assert.equal(workspace.getSnapshot().served, null);
  assert.equal(s.served.operations, 0);
  await workspace.dispose();
});

test("the Connect form connects to a running a4 serve, remembers it, and shows its pages", async () => {
  const s = setup();
  await s.served.pages.create(n("Brief"), "served brief");
  const { workspace, notices } = s.open();
  await workspace.start();
  const result = await workspace.connectServed(SERVED, "form");
  assert.ok(result.ok);
  assert.deepEqual(result.value, { connected: true });
  assert.deepEqual(workspace.getSnapshot().served, { address: "127.0.0.1:4320", shown: true });
  assert.ok(names(workspace).includes(n("Brief")));
  assert.equal(
    notices.some((x) => x.kind === "served-unreachable"),
    false,
  );
  await workspace.dispose();
  const reloaded = s.open();
  await reloaded.workspace.start();
  assert.equal(reloaded.workspace.getSnapshot().served?.shown, true, "a reload connects to it again");
  await reloaded.workspace.dispose();
});

test("a refused link while another served library is shown shows this browser's library, as its notice says", async () => {
  const s = setup();
  await s.served.pages.create(n("Brief"), "served brief");
  const { workspace, notices } = s.open();
  await workspace.start();
  await workspace.createPage("Notes", "my notes", "a");
  assert.ok((await workspace.connectServed(SERVED)).ok);
  assert.equal(workspace.getSnapshot().storage?.kind, "served");
  const older = new ServedStandIn(OTHER);
  older.refusal = "older-server";
  s.serve(older);
  const other: ServedConnection = { address: "127.0.0.1:4321", token: TOKEN };
  assert.ok((await workspace.connectServed(other)).ok);
  const snapshot = workspace.getSnapshot();
  assert.equal(snapshot.storage?.kind, "memory", "this browser's library is shown");
  assert.deepEqual(snapshot.served, { address: "127.0.0.1:4321", shown: false });
  assert.ok(names(workspace).includes(n("Notes")));
  const notice = notices.at(-1);
  assert.ok(notice?.kind === "served-unreachable" && notice.reason === "older-server");
  workspace.edit("a", "typed after the notice");
  await workspace.flushAll();
  const notes = (await s.served.pages.list()).map((p) => p.name);
  assert.deepEqual(notes, [n("Brief")], "nothing typed after the notice reached the served folder");
  await workspace.dispose();
});

test("the Connect form asks a4 serve once, and remembers nothing if it stops before its pages are shown", async () => {
  const s = setup();
  let answered = 0;
  const stops = new ServedStandIn();
  const library = stops.library.bind(stops);
  stops.library = async () => {
    answered++;
    const id = await library();
    stops.down = true; // it answers GetLibrary, then stops
    return id;
  };
  s.serve(stops);
  const { workspace, notices } = s.open();
  await workspace.start();
  const result = await workspace.connectServed(SERVED, "form");
  assert.ok(result.ok);
  assert.equal(result.value.connected, false);
  assert.equal(!result.value.connected && result.value.reason, "not-running");
  assert.equal(answered, 1, "GetLibrary is asked once");
  assert.equal(workspace.getSnapshot().served, null, "nothing is remembered");
  assert.equal(workspace.getSnapshot().storage?.kind, "memory");
  assert.equal(
    notices.some((x) => x.kind === "served-unreachable"),
    false,
    "the form says why, not a notice",
  );
  await workspace.dispose();
});
