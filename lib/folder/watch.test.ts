import { test } from "node:test";
import assert from "node:assert/strict";
import { Journal } from "../autosave/journal.ts";
import { createFileSession, type SessionEvent } from "../autosave/session.ts";
import { FakeScheduler } from "../autosave/testing/fake-scheduler.ts";
import { MemoryHandleStore } from "../platform/handle-store.ts";
import { MemoryKeyValue } from "../platform/key-value.ts";
import { MemoryPageStore } from "../store/key-value.ts";
import { pageNameCodec, parsePageName } from "../store/names.ts";
import { fileCopyName, filePathCodec, parseFilePath, type FilePath } from "../store/refs.ts";
import { FolderAccess } from "./access.ts";
import { FolderRegistry } from "./registry.ts";
import { browserFixture, nodeFixture, type FolderFixture } from "./testing/fixtures.ts";
import { FileWatcher } from "./watch.ts";

let ids = 0;
const nextId = () => `folder${++ids}`;

/** The watcher tests, on one adapter. `makeFixture` gets the fake clock file times should follow. */
function suite<H>(label: string, makeFixture: (clock: () => number) => Promise<FolderFixture<H>>) {
  async function setup() {
    const scheduler = new FakeScheduler();
    const fixture = await makeFixture(() => 1_000_000 + scheduler.now);
    const repo = await fixture.folder("a4", { "AGENTS.md": "# Agents\n" });
    const kv = new MemoryKeyValue();
    const registry = new FolderRegistry({
      kv,
      handles: new MemoryHandleStore<H>(),
      source: fixture.source,
      randomId: nextId,
    });
    const access = new FolderAccess({
      registry,
      source: fixture.source,
      kv,
      tabId: "tab1",
      supported: true,
      locks: null,
    });
    const state = await access.open(repo.handle);
    if (state.status !== "connected") throw new Error("not connected");
    const folder = state.folder;
    const library = new MemoryPageStore();
    const path = parseFilePath("AGENTS.md");
    const events: SessionEvent<FilePath>[] = [];
    const session = createFileSession(
      folder.sheet,
      new Journal(kv, "tab1", filePathCodec, { prefix: `a4:folder:${folder.id}:` }),
      await folder.sheet.read(path),
      { library, libraryJournal: new Journal(kv, "tab1", pageNameCodec), copyName: fileCopyName },
      { scheduler, onEvent: (e) => events.push(e) },
    );
    let visible = true;
    const reloaded: string[] = [];
    const watcher = new FileWatcher({
      folder,
      scheduler,
      isVisible: () => visible,
      onReloaded: (_key, page) => reloaded.push(page.text),
    });
    watcher.watch("a", path, session);
    await scheduler.advance(0);
    await fixture.idle();
    /** Advance fake time, then let real file I/O catch up. */
    const advance = async (ms: number) => {
      await scheduler.advance(ms);
      await fixture.idle();
    };
    return {
      fixture,
      scheduler: { advance },
      repo,
      session,
      library,
      events,
      reloaded,
      setVisible: (v: boolean) => {
        visible = v;
      },
    };
  }

  const run = (name: string, body: (s: Awaited<ReturnType<typeof setup>>) => Promise<void>) =>
    test(`${label}: ${name}`, async () => {
      const s = await setup();
      try {
        await body(s);
      } finally {
        await s.fixture.dispose();
      }
    });

  run("a change made by another program is adopted within 2 s", async ({ scheduler, repo, session, reloaded }) => {
    await scheduler.advance(300);
    await repo.put("AGENTS.md", "# Agents\nEdited elsewhere\n");
    await scheduler.advance(2000);
    assert.equal(session.text, "# Agents\nEdited elsewhere");
    assert.deepEqual(reloaded, ["# Agents\nEdited elsewhere"]);
    assert.ok((repo.writes("AGENTS.md") ?? 0) <= 1, "A4 didn't write the file back");
  });

  run(
    "a change on disk during edits ends in a library conflict copy; the file is not overwritten",
    async ({ scheduler, repo, session, library, events, reloaded }) => {
      session.update("# Agents\nTyped in A4");
      await repo.put("AGENTS.md", "# Agents\nChecked out\n");
      await scheduler.advance(2000);
      assert.deepEqual(reloaded, []);
      assert.equal(await repo.text("AGENTS.md"), "# Agents\nChecked out\n");
      const conflict = events.find((e) => e.type === "conflict");
      assert.ok(conflict?.type === "conflict" && conflict.moved);
      assert.equal((await library.read(parsePageName(conflict.copy))).text, "# Agents\nTyped in A4");
    },
  );

  run("A4's own saves are not reported as outside changes", async ({ scheduler, repo, session, reloaded }) => {
    session.update("# Agents\nMine");
    await scheduler.advance(3000);
    assert.equal(await repo.text("AGENTS.md"), "# Agents\nMine\n");
    assert.deepEqual(reloaded, []);
    assert.equal(session.text, "# Agents\nMine");
  });

  run("nothing is polled while the tab is hidden", async ({ scheduler, repo, session, setVisible }) => {
    setVisible(false);
    await repo.put("AGENTS.md", "# Agents\nWhile hidden\n");
    await scheduler.advance(5000);
    assert.equal(session.text, "# Agents");
    setVisible(true);
    await scheduler.advance(1000);
    assert.equal(session.text, "# Agents\nWhile hidden");
  });
}

suite("browser", async (clock) => browserFixture(clock));
suite("node", () => nodeFixture());
