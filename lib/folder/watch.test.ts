import { test } from "node:test";
import assert from "node:assert/strict";
import { Journal } from "../autosave/journal.ts";
import { PageSession, type SessionEvent } from "../autosave/session.ts";
import { FakeScheduler } from "../autosave/testing/fake-scheduler.ts";
import { MemoryKeyValue, MemoryPageStore } from "../store/key-value.ts";
import { parsePageName } from "../store/names.ts";
import { fileCopyName, parseFilePath, type FilePath } from "../store/refs.ts";
import { asDirectoryHandle, FakeDirectoryHandle, FakeVolume } from "../store/testing/fake-opfs.ts";
import { FolderConnection, MemoryHandleStore } from "./connection.ts";
import { FileWatcher } from "./watch.ts";

async function setup() {
  const scheduler = new FakeScheduler();
  const volume = new FakeVolume(() => 1_000_000 + scheduler.now);
  const root = new FakeDirectoryHandle("a4", volume);
  root.put("AGENTS.md", "# Agents\n");
  const kv = new MemoryKeyValue();
  const connection = new FolderConnection({ kv, handles: new MemoryHandleStore(), tabId: "tab1", supported: true, locks: null });
  const state = await connection.open(asDirectoryHandle(root));
  if (state.status !== "connected") throw new Error("not connected");
  const folder = state.folder;
  const library = new MemoryPageStore();
  const path = parseFilePath("AGENTS.md");
  const events: SessionEvent<FilePath>[] = [];
  const session = new PageSession<FilePath>({
    store: folder.sheet,
    journal: new Journal<FilePath>(kv, "tab1", { prefix: `a4:folder:${folder.id}:` }),
    copies: library,
    copyName: fileCopyName,
    scheduler,
    page: await folder.sheet.read(path),
    onEvent: (e) => events.push(e),
  });
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
  return { scheduler, root, session, library, events, watcher, reloaded, setVisible: (v: boolean) => (visible = v) };
}

test("a change made by another program is adopted within 2 s", async () => {
  const { scheduler, root, session, reloaded } = await setup();
  await scheduler.advance(300);
  root.fileAt("AGENTS.md")!.setContent("# Agents\nEdited elsewhere\n");
  await scheduler.advance(2000);
  assert.equal(session.text, "# Agents\nEdited elsewhere");
  assert.deepEqual(reloaded, ["# Agents\nEdited elsewhere"]);
  assert.equal(root.fileAt("AGENTS.md")!.writes, 0);
});

test("a change on disk during edits ends in a library conflict copy; the file is not overwritten", async () => {
  const { scheduler, root, session, library, events, reloaded } = await setup();
  session.update("# Agents\nTyped in A4");
  root.fileAt("AGENTS.md")!.setContent("# Agents\nChecked out\n");
  await scheduler.advance(2000);
  assert.deepEqual(reloaded, []);
  assert.equal(root.fileAt("AGENTS.md")!.text, "# Agents\nChecked out\n");
  const conflict = events.find((e) => e.type === "conflict") as { copy: string; moved: boolean };
  assert.ok(conflict?.moved);
  assert.equal((await library.read(parsePageName(conflict.copy))).text, "# Agents\nTyped in A4");
});

test("A4's own saves are not reported as outside changes", async () => {
  const { scheduler, root, session, reloaded } = await setup();
  session.update("# Agents\nMine");
  await scheduler.advance(3000);
  assert.equal(root.fileAt("AGENTS.md")!.text, "# Agents\nMine\n");
  assert.deepEqual(reloaded, []);
  assert.equal(session.text, "# Agents\nMine");
});

test("nothing is polled while the tab is hidden", async () => {
  const { scheduler, root, session, setVisible } = await setup();
  setVisible(false);
  root.fileAt("AGENTS.md")!.setContent("# Agents\nWhile hidden\n");
  await scheduler.advance(5000);
  assert.equal(session.text, "# Agents");
  setVisible(true);
  await scheduler.advance(1000);
  assert.equal(session.text, "# Agents\nWhile hidden");
});
