import { test } from "node:test";
import assert from "node:assert/strict";
import { Journal } from "../autosave/journal.ts";
import { MemoryKeyValue, MemoryPageStore } from "../store/key-value.ts";
import { parsePageName } from "../store/names.ts";
import { parseFilePath, type FilePath } from "../store/refs.ts";
import { asDirectoryHandle, FakeDirectoryHandle, FakeVolume } from "../store/testing/fake-opfs.ts";
import { FOLDER_KEY, FolderConnection, MemoryHandleStore } from "./connection.ts";

function setup(options: { supported?: boolean } = {}) {
  const kv = new MemoryKeyValue();
  const handles = new MemoryHandleStore();
  const volume = new FakeVolume();
  const parent = new FakeDirectoryHandle("", volume);
  const make = (tabId = "tab1") =>
    new FolderConnection({ kv, handles, tabId, supported: options.supported ?? true, locks: null });
  return { kv, handles, volume, parent, make };
}

async function repo(parent: FakeDirectoryHandle) {
  const root = await parent.getDirectoryHandle("a4", { create: true });
  root.put("AGENTS.md", "# Agents\n");
  return root;
}

test("without a folder picker the state is unsupported", async () => {
  const { make } = setup({ supported: false });
  const connection = make();
  assert.equal(connection.state.status, "unsupported");
  assert.equal((await connection.restore()).status, "unsupported");
});

test("nothing remembered: none; opening a folder connects and remembers it", async () => {
  const { make, parent, kv, handles } = setup();
  const connection = make();
  assert.equal((await connection.restore()).status, "none");
  const root = await repo(parent);
  const state = await connection.open(asDirectoryHandle(root));
  assert.equal(state.status, "connected");
  assert.equal(state.status === "connected" && state.name, "a4");
  const id = kv.get(FOLDER_KEY)!;
  assert.ok(id);
  assert.equal(await handles.get(id), asDirectoryHandle(root));
  if (state.status === "connected") {
    assert.equal((await state.folder.sheet.read(parseFilePath("AGENTS.md"))).text, "# Agents");
  }
});

test("a reload reconnects silently while the browser grants access", async () => {
  const { make, parent } = setup();
  await make().open(asDirectoryHandle(await repo(parent)));
  const states: string[] = [];
  const next = make("tab2");
  next.subscribe((s) => states.push(s.status));
  assert.equal((await next.restore()).status, "connected");
  assert.deepEqual(states, ["connecting", "connected"]);
});

test("when the browser asks again: reconnect, then granted or still waiting", async () => {
  const { make, parent, volume } = setup();
  await make().open(asDirectoryHandle(await repo(parent)));
  volume.permission = "prompt";
  const next = make("tab2");
  const restored = await next.restore();
  assert.equal(restored.status, "reconnect");
  assert.equal(restored.status === "reconnect" && restored.name, "a4");

  volume.grantOnRequest = false;
  assert.equal((await next.reconnect()).status, "reconnect");
  volume.permission = "prompt";
  volume.grantOnRequest = true;
  assert.equal((await next.reconnect()).status, "connected");
  assert.equal(volume.prompts, 2);
});

test("a deleted folder is not found", async () => {
  const { make, parent } = setup();
  await make().open(asDirectoryHandle(await repo(parent)));
  await parent.removeEntry("a4", { recursive: true });
  assert.equal((await make("tab2").restore()).status, "not-found");
});

test("a remembered id without a stored handle is not found", async () => {
  const { make, kv } = setup();
  kv.set(FOLDER_KEY, "missing");
  assert.equal((await make().restore()).status, "not-found");
});

test("forgetting turns leftover drafts into library copies and forgets the folder", async () => {
  const { make, parent, kv, handles } = setup();
  const connection = make();
  const state = await connection.open(asDirectoryHandle(await repo(parent)));
  assert.equal(state.status, "connected");
  const id = kv.get(FOLDER_KEY)!;
  const path = parseFilePath(".claude/skills/review/SKILL.md");
  new Journal<FilePath>(kv, "dead-tab", { prefix: `a4:folder:${id}:` }).set(path, "crashed edits", null);
  new Journal<FilePath>(kv, "live-tab", { prefix: `a4:folder:${id}:` }).set(path, "still typing", null);
  const library = new MemoryPageStore();
  const copies = await connection.forget(library, new Set(["tab1", "live-tab"]));
  assert.equal(copies.length, 1);
  assert.match(copies[0], /^claude › skills › review › SKILL\.md \(recovered /);
  assert.equal((await library.read(parsePageName(copies[0]))).text, "crashed edits");
  assert.equal(connection.state.status, "none");
  assert.equal(kv.get(FOLDER_KEY), null);
  assert.equal(await handles.get(id), null);
  // The live tab's draft is left alone, and no file was touched.
  assert.equal(new Journal<FilePath>(kv, "live-tab", { prefix: `a4:folder:${id}:` }).get(path)?.text, "still typing");
});

test("recover applies a crashed file draft on connect", async () => {
  const { make, parent, kv } = setup();
  const root = await repo(parent);
  const first = await make().open(asDirectoryHandle(root));
  assert.equal(first.status, "connected");
  const id = kv.get(FOLDER_KEY)!;
  if (first.status !== "connected") return;
  const page = await first.folder.sheet.read(parseFilePath("AGENTS.md"));
  new Journal<FilePath>(kv, "dead-tab", { prefix: `a4:folder:${id}:` }).set(
    page.name,
    "# Agents\nunsaved",
    page.revision,
  );
  const next = make("tab2");
  await next.restore();
  const report = await next.recover(new MemoryPageStore(), new Set(["tab2"]));
  assert.deepEqual(report, [{ kind: "applied", page: "AGENTS.md", savedAs: "AGENTS.md" }]);
  assert.equal(root.fileAt("AGENTS.md")!.text, "# Agents\nunsaved\n");
});

test("picking a folder A4 already knows keeps its id, journal prefix, and lock names", async () => {
  const { make, parent, kv, handles } = setup();
  const root = await repo(parent);
  const first = await make("tab1").open(asDirectoryHandle(root));
  const id = kv.get(FOLDER_KEY)!;
  assert.equal(first.status === "connected" && first.folder.id, id);
  // Another tab picks the same folder.
  const second = await make("tab2").open(asDirectoryHandle(root));
  assert.equal(second.status === "connected" && second.folder.id, id);
  assert.equal(kv.get(FOLDER_KEY), id);
  assert.equal((await handles.entries()).length, 1);
  // A different folder gets a new id.
  const other = await parent.getDirectoryHandle("other", { create: true });
  other.put("AGENTS.md", "x");
  const third = await make("tab3").open(asDirectoryHandle(other));
  assert.ok(third.status === "connected" && third.folder.id !== id);
});
