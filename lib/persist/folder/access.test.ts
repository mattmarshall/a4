import { test } from "node:test";
import assert from "node:assert/strict";
import { Journal } from "../autosave/journal.ts";
import { MemoryHandleStore } from "../../platform/handle-store.ts";
import { MemoryKeyValue } from "../../platform/key-value.ts";
import { MemoryPageStore } from "../store/key-value.ts";
import { pageNameCodec, parsePageName } from "../store/names.ts";
import { filePathCodec, parseFilePath } from "../store/refs.ts";
import { FolderAccess } from "./access.ts";
import { FOLDER_KEY, FolderRegistry } from "./registry.ts";
import { browserFixture, nodeFixture, type FolderFixture } from "./testing/fixtures.ts";

let ids = 0;
const nextId = () => `folder${++ids}`;

function tabs<H>(fixture: FolderFixture<H>, options: { supported?: boolean } = {}) {
  const kv = new MemoryKeyValue();
  const handles = new MemoryHandleStore<H>();
  const registry = new FolderRegistry({ kv, handles, source: fixture.source, randomId: nextId });
  const make = (tabId = "tab1") =>
    new FolderAccess({
      registry,
      source: fixture.source,
      kv,
      tabId,
      supported: options.supported ?? true,
      locks: null,
    });
  return { kv, handles, make };
}

/** The access tests, on one adapter. */
function suite<H>(label: string, makeFixture: () => Promise<FolderFixture<H>>) {
  const run = (name: string, body: (fixture: FolderFixture<H>) => Promise<void>) =>
    test(`${label}: ${name}`, async () => {
      const fixture = await makeFixture();
      try {
        await body(fixture);
      } finally {
        await fixture.dispose();
      }
    });

  run("without a folder picker the state is unsupported", async (fixture) => {
    const access = tabs(fixture, { supported: false }).make();
    assert.equal(access.state.status, "unsupported");
    assert.equal((await access.restore()).status, "unsupported");
  });

  run("nothing remembered: none; opening a folder connects and remembers it", async (fixture) => {
    const { make, kv, handles } = tabs(fixture);
    const access = make();
    assert.equal((await access.restore()).status, "none");
    const repo = await fixture.folder("a4", { "AGENTS.md": "# Agents\n" });
    const state = await access.open(repo.handle);
    assert.equal(state.status, "connected");
    assert.equal(state.status === "connected" && state.name, "a4");
    const id = kv.get(FOLDER_KEY);
    assert.ok(id);
    assert.equal(await handles.get(id), repo.handle);
    if (state.status === "connected") {
      assert.equal((await state.folder.sheet.read(parseFilePath("AGENTS.md"))).text, "# Agents");
    }
  });

  run("a reload reconnects silently while access is granted", async (fixture) => {
    const { make } = tabs(fixture);
    await make().open((await fixture.folder("a4", { "AGENTS.md": "x" })).handle);
    const states: string[] = [];
    const next = make("tab2");
    next.subscribe((s) => states.push(s.status));
    assert.equal((await next.restore()).status, "connected");
    assert.deepEqual(states, ["connecting", "connected"]);
  });

  run("a deleted folder is not found", async (fixture) => {
    const { make } = tabs(fixture);
    const repo = await fixture.folder("a4", { "AGENTS.md": "x" });
    await make().open(repo.handle);
    await repo.remove();
    assert.equal((await make("tab2").restore()).status, "not-found");
  });

  run("a remembered id without a stored handle is not found", async (fixture) => {
    const { make, kv } = tabs(fixture);
    kv.set(FOLDER_KEY, "missing");
    assert.equal((await make().restore()).status, "not-found");
  });

  run("forgetting recovers leftover drafts into the library and forgets the folder", async (fixture) => {
    const { make, kv, handles } = tabs(fixture);
    const access = make();
    const repo = await fixture.folder("a4", { "AGENTS.md": "# Agents\n" });
    assert.equal((await access.open(repo.handle)).status, "connected");
    const id = kv.get(FOLDER_KEY) ?? "";
    const path = parseFilePath(".claude/skills/review/SKILL.md");
    const journal = (tab: string) => new Journal(kv, tab, filePathCodec, { prefix: `a4:folder:${id}:` });
    journal("dead-tab").set(path, "crashed edits", null);
    journal("live-tab").set(path, "still typing", null);
    const library = new MemoryPageStore();
    const copies = await access.forget(library, new Journal(kv, "tab1", pageNameCodec), new Set(["tab1", "live-tab"]));
    assert.equal(copies.length, 1);
    assert.match(copies[0] ?? "", /^claude › skills › review › SKILL\.md \(recovered /);
    assert.equal((await library.read(parsePageName(copies[0] ?? ""))).text, "crashed edits");
    assert.equal(access.state.status, "none");
    assert.equal(kv.get(FOLDER_KEY), null);
    assert.equal(await handles.get(id), null);
    // The live tab's draft is left alone, and no file was touched.
    assert.equal(journal("live-tab").get(path)?.text, "still typing");
    assert.equal(await repo.text(".claude/skills/review/SKILL.md"), null);
  });

  run("forgetting a folder that can't be reached copies every draft out", async (fixture) => {
    const { make, kv } = tabs(fixture);
    const repo = await fixture.folder("a4", { "AGENTS.md": "# Agents\n" });
    await make().open(repo.handle);
    const id = kv.get(FOLDER_KEY) ?? "";
    new Journal(kv, "tab2", filePathCodec, { prefix: `a4:folder:${id}:` }).set(
      parseFilePath("AGENTS.md"),
      "mine, unsaved",
      null,
    );
    await repo.remove();
    const next = make("tab2");
    assert.equal((await next.restore()).status, "not-found");
    const library = new MemoryPageStore();
    const copies = await next.forget(library, new Journal(kv, "tab2", pageNameCodec), null);
    assert.equal(copies.length, 1);
    assert.equal((await library.read(parsePageName(copies[0] ?? ""))).text, "mine, unsaved");
  });

  run("recover applies a crashed file draft on connect", async (fixture) => {
    const { make, kv } = tabs(fixture);
    const repo = await fixture.folder("a4", { "AGENTS.md": "# Agents\n" });
    const first = await make().open(repo.handle);
    if (first.status !== "connected") throw new Error("not connected");
    const id = kv.get(FOLDER_KEY) ?? "";
    const page = await first.folder.sheet.read(parseFilePath("AGENTS.md"));
    new Journal(kv, "dead-tab", filePathCodec, { prefix: `a4:folder:${id}:` }).set(
      page.name,
      "# Agents\nunsaved",
      page.revision,
    );
    const next = make("tab2");
    await next.restore();
    const report = await next.recover(new MemoryPageStore(), new Journal(kv, "tab3", pageNameCodec), new Set(["tab2"]));
    assert.deepEqual(report, [{ kind: "applied", page: "AGENTS.md" }]);
    assert.equal(await repo.text("AGENTS.md"), "# Agents\nunsaved\n");
  });

  run("picking a folder A4 already knows keeps its id", async (fixture) => {
    const { make, kv, handles } = tabs(fixture);
    const repo = await fixture.folder("a4", { "AGENTS.md": "x" });
    const first = await make("tab1").open(repo.handle);
    const id = kv.get(FOLDER_KEY);
    assert.equal(first.status === "connected" && first.folder.id, id);
    const second = await make("tab2").open(repo.handle);
    assert.equal(second.status === "connected" && second.folder.id, id);
    assert.equal((await handles.entries()).length, 1);
    const other = await fixture.folder("other", { "AGENTS.md": "x" });
    const third = await make("tab3").open(other.handle);
    assert.ok(third.status === "connected" && third.folder.id !== id);
  });
}

suite("browser", async () => browserFixture());
suite("node", nodeFixture);

test("browser: when the browser asks again: reconnect, then granted or still waiting", async () => {
  const fixture = browserFixture();
  const volume = fixture.volume;
  if (!volume) throw new Error("no volume");
  const { make } = tabs(fixture);
  await make().open((await fixture.folder("a4", { "AGENTS.md": "x" })).handle);
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
