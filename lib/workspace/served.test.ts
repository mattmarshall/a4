import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeScheduler, settle } from "../persist/autosave/testing/fake-scheduler.ts";
import { browserFolderSource } from "../persist/folder/fs-browser.ts";
import { MemoryHandleStore } from "../platform/handle-store.ts";
import { MemoryKeyValue } from "../platform/key-value.ts";
import { ChannelHub, fakePlatform, FakeTabs } from "../platform/testing/fakes.ts";
import { readSetting, SETTINGS } from "../persist/settings.ts";
import { MemoryPageStore } from "../persist/store/key-value.ts";
import { parsePageName } from "../persist/store/names.ts";
import type { ServedConnection } from "../persist/store/served.ts";
import {
  type PageName,
  type PageStore,
  type Revision,
  StoreUnavailableError,
  type TrashId,
} from "../persist/store/types.ts";
import type { WorkspaceNotice } from "./types.ts";
import { Workspace } from "./workspace.ts";

const n = parsePageName;
const TOKEN = "t".repeat(43);
const SERVED: ServedConnection = { address: "127.0.0.1:4320", token: TOKEN };

/** A memory store standing in for `a4 serve`: it can be stopped, and counts listings. */
class ServedStandIn implements PageStore {
  readonly kind = "served" as const;
  readonly durable = true;
  readonly pages = new MemoryPageStore();
  down = false;
  listings = 0;

  #up(): void {
    if (this.down) throw new StoreUnavailableError("a4 serve isn’t running at 127.0.0.1:4320.");
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
      openServed: () => served,
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
    s.keyValue.keys().some((k) => k.startsWith("a4:served:127.0.0.1:4320:draft:")),
    "journaled under the served prefix",
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
