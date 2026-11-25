import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeScheduler, settle } from "../persist/autosave/testing/fake-scheduler.ts";
import { browserFolderSource } from "../persist/folder/fs-browser.ts";
import { MemoryHandleStore } from "../platform/handle-store.ts";
import { MemoryKeyValue } from "../platform/key-value.ts";
import { ChannelHub, FakeLocks, fakePlatform, FakeTabs } from "../platform/testing/fakes.ts";
import { readSetting, SETTINGS } from "../persist/settings.ts";
import { MemoryPageStore } from "../persist/store/key-value.ts";
import { parsePageName } from "../persist/store/names.ts";
import { fileRef, libraryRef, parseFilePath } from "../persist/store/refs.ts";
import { asDirectoryHandle, FakeDirectoryHandle, FakeVolume } from "../persist/store/testing/fake-opfs.ts";
import type { PageStore } from "../persist/store/types.ts";
import type { WorkspaceNotice } from "./types.ts";
import { Workspace } from "./workspace.ts";
import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import {
  letterDigest,
  LetterState,
  LetterVerdict,
  PostmarkExistsError,
  postmarkJson,
  PostmarkSchema,
} from "../desk/index.ts";

const n = parsePageName;

/** One browser: tabs that share storage, the channel hub, tab liveness, and folder handles. */
function browser(options: { store?: PageStore; locks?: FakeLocks } = {}) {
  const scheduler = new FakeScheduler();
  const keyValue = new MemoryKeyValue();
  const hub = new ChannelHub();
  const tabs = new FakeTabs();
  const handles = new MemoryHandleStore<FileSystemDirectoryHandle>();
  const volume = new FakeVolume(() => 1_000_000 + scheduler.now);
  const store = options.store ?? new MemoryPageStore();
  const open = (
    openStore: () => Promise<{ store: PageStore; movedFromFallback: number }> = async () => ({
      store,
      movedFromFallback: 0,
    }),
  ) => {
    const platform = fakePlatform({ scheduler, keyValue, hub, tabs, locks: options.locks ?? null });
    const notices: WorkspaceNotice[] = [];
    const workspace = new Workspace({
      platform,
      folders: { source: browserFolderSource, handles },
      welcomeText: "Welcome to A4",
      skipMigration: [],
      openStore,
      scheduler,
    });
    workspace.subscribeNotices((notice) => notices.push(notice));
    return { workspace, notices };
  };
  return { scheduler, store, volume, open, keyValue };
}

function folder(volume: FakeVolume, files: Record<string, string>) {
  const root = new FakeDirectoryHandle("repo", volume);
  for (const [path, text] of Object.entries(files)) root.put(path, text);
  return root;
}

test("start runs once, and can be retried after a failure", async () => {
  const b = browser();
  let attempts = 0;
  const { workspace } = b.open(async () => {
    attempts++;
    if (attempts === 1) throw new Error("disk unavailable");
    return { store: b.store, movedFromFallback: 0 };
  });
  const failed = await workspace.start();
  assert.equal(failed.ok, false);
  assert.equal(workspace.getSnapshot().status.kind, "failed");
  const [again, twice] = await Promise.all([workspace.start(), workspace.start()]);
  assert.ok(again.ok && twice.ok);
  assert.equal(attempts, 2);
  const snapshot = workspace.getSnapshot();
  assert.equal(snapshot.status.kind, "ready");
  assert.equal(snapshot.slots.a.name, "Welcome");
  assert.equal(snapshot.slots.a.text, "Welcome to A4");
  assert.deepEqual(
    snapshot.library.pages.map((p) => p.name),
    ["Welcome"],
  );
});

test("create, rename, trash, and restore keep the lists and the open slot in step", async () => {
  const b = browser();
  const { workspace, notices } = b.open();
  await workspace.start();
  const created = await workspace.createPage("Brief", "first draft", "a");
  assert.ok(created.ok);
  assert.equal(workspace.getSnapshot().slots.a.name, "Brief");

  assert.ok((await workspace.renamePage(n("Brief"), "Field brief")).ok);
  assert.equal(workspace.getSnapshot().slots.a.name, "Field brief");
  assert.deepEqual(readSetting(SETTINGS.openA), libraryRef(n("Field brief")));
  const renamed = await workspace.renamePage(n("Field brief"), "a/b");
  assert.equal(renamed.ok, false, "an invalid name is a failed result, not a throw");

  assert.ok((await workspace.trashPage(n("Field brief"))).ok);
  let snapshot = workspace.getSnapshot();
  assert.equal(snapshot.slots.a.name, "Welcome", "the slot moves to another page");
  assert.deepEqual(
    snapshot.library.trash.map((t) => t.name),
    ["Field brief"],
  );
  const id = snapshot.library.trash[0]?.id;
  assert.ok(id);
  assert.ok((await workspace.restorePage(id)).ok);
  snapshot = workspace.getSnapshot();
  assert.deepEqual(snapshot.library.pages.map((p) => p.name).sort(), ["Field brief", "Welcome"]);
  assert.deepEqual(
    notices.filter((x) => x.kind !== "not-durable").map((x) => x.kind),
    ["trashed", "restored"],
  );
});

test("edits are journaled at once and saved after the pause; dispose flushes", async () => {
  const b = browser();
  const { workspace } = b.open();
  await workspace.start();
  workspace.edit("a", "Welcome to A4, edited");
  assert.equal(workspace.getSnapshot().slots.a.text, "Welcome to A4, edited");
  assert.equal(workspace.getSnapshot().slots.a.status, "unsaved");
  assert.ok(
    b.keyValue.keys().some((k) => k.startsWith("a4:draft:")),
    "journaled before any save",
  );
  await b.scheduler.advance(600);
  assert.equal((await b.store.read(n("Welcome"))).text, "Welcome to A4, edited");
  workspace.edit("a", "one more edit");
  await workspace.dispose();
  assert.equal((await b.store.read(n("Welcome"))).text, "one more edit");
});

test("a page saved in another tab is adopted by a tab showing it with no edits", async () => {
  const b = browser();
  const one = b.open();
  const two = b.open();
  await one.workspace.start();
  await two.workspace.start();
  one.workspace.edit("a", "saved in tab one");
  await b.scheduler.advance(600);
  await settle();
  assert.equal(two.workspace.getSnapshot().slots.a.text, "saved in tab one");
  // A page created in one tab shows up in the other's list.
  await one.workspace.createPage("Plan", "", "b");
  await settle();
  assert.ok(two.workspace.getSnapshot().library.pages.some((p) => p.name === "Plan"));
});

test("a page open in both slots is swapped instead, and swapSlots exchanges them", async () => {
  const b = browser();
  const { workspace } = b.open();
  await workspace.start();
  await workspace.createPage("Plan", "plan text", "b");
  assert.equal(workspace.getSnapshot().slots.b.name, "Plan");
  // Opening B's page in A exchanges the slots: a page shows in one slot at a time.
  assert.ok((await workspace.open("a", n("Plan"))).ok);
  let snapshot = workspace.getSnapshot();
  assert.equal(snapshot.slots.a.name, "Plan");
  assert.equal(snapshot.slots.b.name, "Welcome");
  assert.ok((await workspace.swapSlots()).ok);
  snapshot = workspace.getSnapshot();
  assert.equal(snapshot.slots.a.name, "Welcome");
  assert.equal(snapshot.slots.b.name, "Plan");
  // Edits still reach the right page after the swaps.
  workspace.edit("b", "plan text, edited");
  await b.scheduler.advance(600);
  assert.equal((await b.store.read(n("Plan"))).text, "plan text, edited");
});

test("a conflict with another tab saves a copy and follows it", async () => {
  const b = browser();
  const { workspace, notices } = b.open();
  await workspace.start();
  await b.store.write(n("Welcome"), "changed in another tab");
  workspace.edit("a", "my edit");
  await b.scheduler.advance(600);
  await settle();
  const slot = workspace.getSnapshot().slots.a;
  assert.match(slot.name ?? "", /^Welcome \(conflict /);
  assert.equal(slot.text, "my edit");
  assert.equal((await b.store.read(n("Welcome"))).text, "changed in another tab");
  assert.ok(notices.some((x) => x.kind === "conflict" && !x.moved));
});

test("Compare opens B, and leaving it saves and closes B", async () => {
  const b = browser();
  const { workspace } = b.open();
  await workspace.start();
  assert.ok((await workspace.ensureSlotB()).ok);
  assert.equal(workspace.getSnapshot().slots.b.name, "Untitled", "only one page existed, so B gets a new one");
  workspace.edit("b", "typed in B");
  await workspace.closeSlotB();
  assert.equal(workspace.getSnapshot().slots.b.ref, null);
  assert.equal((await b.store.read(n("Untitled"))).text, "typed in B");
});

test("a folder file's conflict goes to the library, keeping keys typed during the copy", async () => {
  const b = browser();
  const { workspace, notices } = b.open();
  await workspace.start();
  const root = folder(b.volume, { "AGENTS.md": "# Agents\n" });
  assert.ok((await workspace.openFolder(asDirectoryHandle(root))).ok);
  assert.ok((await workspace.open("a", fileRef(parseFilePath("AGENTS.md")))).ok);
  assert.equal(workspace.getSnapshot().slots.a.text, "# Agents");
  root.fileAt("AGENTS.md")?.setContent("# Agents\nchecked out\n");
  workspace.edit("a", "# Agents\nmine");
  await b.scheduler.advance(600);
  // More keys while the copy is being saved.
  workspace.edit("a", "# Agents\nmine, and more");
  await settle();
  await b.scheduler.advance(600);
  const slot = workspace.getSnapshot().slots.a;
  assert.equal(slot.ref?.kind, "library");
  assert.match(slot.name ?? "", /^AGENTS\.md \(conflict /);
  assert.equal(slot.text, "# Agents\nmine, and more");
  assert.equal(root.fileAt("AGENTS.md")?.text, "# Agents\nchecked out\n", "the file is not overwritten");
  assert.ok(notices.some((x) => x.kind === "conflict" && x.moved));
});

test("a reload reconnects the folder and reopens a remembered file in B", async () => {
  const b = browser();
  const first = b.open();
  await first.workspace.start();
  const root = folder(b.volume, { "AGENTS.md": "# Agents\n", "CLAUDE.md": "# Claude\n" });
  await first.workspace.openFolder(asDirectoryHandle(root));
  await first.workspace.ensureSlotB();
  assert.ok((await first.workspace.open("b", fileRef(parseFilePath("CLAUDE.md")))).ok);
  await first.workspace.dispose();

  const next = b.open();
  await next.workspace.start();
  const snapshot = next.workspace.getSnapshot();
  assert.equal(snapshot.folder.state.status, "connected");
  assert.deepEqual(
    snapshot.folder.files.map((f) => f.path),
    ["AGENTS.md", "CLAUDE.md"],
  );
  assert.equal(snapshot.slots.b.ref, null, "B waits while Single view is shown");
  assert.ok((await next.workspace.ensureSlotB()).ok);
  assert.deepEqual(next.workspace.getSnapshot().slots.b.ref, fileRef(parseFilePath("CLAUDE.md")));
});

test("a folder that disappears tears down: an open file's edits move to the library", async () => {
  const b = browser();
  const { workspace, notices } = b.open();
  await workspace.start();
  const parent = new FakeDirectoryHandle("", b.volume);
  const root = await parent.getDirectoryHandle("repo", { create: true });
  root.put("AGENTS.md", "# Agents\n");
  await workspace.openFolder(asDirectoryHandle(root));
  await workspace.open("a", fileRef(parseFilePath("AGENTS.md")));
  await parent.removeEntry("repo", { recursive: true });
  workspace.edit("a", "# Agents\nunsaved");
  // Listing the folder again finds it gone.
  await workspace.visible();
  await settle();
  const snapshot = workspace.getSnapshot();
  assert.equal(snapshot.folder.state.status, "not-found");
  // Closing the file saved it, found it gone, and kept the text as a library page.
  assert.equal(snapshot.slots.a.ref?.kind, "library");
  assert.match(snapshot.slots.a.name ?? "", /^AGENTS\.md \(recovered /);
  assert.equal(snapshot.slots.a.text, "# Agents\nunsaved");
  assert.ok(notices.some((x) => x.kind === "recreated" && x.moved));
});

test("losing access closes file sessions with their drafts kept, and reconnecting reopens them", async () => {
  const b = browser();
  const { workspace } = b.open();
  await workspace.start();
  const root = folder(b.volume, { "AGENTS.md": "# Agents\n" });
  await workspace.openFolder(asDirectoryHandle(root));
  await workspace.open("a", fileRef(parseFilePath("AGENTS.md")));
  b.volume.permission = "denied";
  workspace.edit("a", "# Agents\nunsaved");
  await workspace.visible();
  await settle();
  let snapshot = workspace.getSnapshot();
  assert.equal(snapshot.folder.state.status, "reconnect");
  assert.equal(snapshot.slots.a.ref, null);
  assert.ok(
    b.keyValue.keys().some((k) => k.startsWith("a4:folder:") && k.includes(":draft:")),
    "the unsaved edit is still in the folder's journal",
  );
  b.volume.permission = "prompt";
  assert.ok((await workspace.reconnectFolder()).ok);
  snapshot = workspace.getSnapshot();
  assert.equal(snapshot.folder.state.status, "connected");
  assert.deepEqual(snapshot.slots.a.ref, fileRef(parseFilePath("AGENTS.md")));
  assert.equal(snapshot.slots.a.text, "# Agents\nunsaved", "the draft resumes when the file reopens");
});

test("closing the folder opens library pages in its slots", async () => {
  const b = browser();
  const { workspace } = b.open();
  await workspace.start();
  const root = folder(b.volume, { "AGENTS.md": "# Agents\n" });
  await workspace.openFolder(asDirectoryHandle(root));
  await workspace.open("a", fileRef(parseFilePath("AGENTS.md")));
  workspace.edit("a", "# Agents\nsaved on close");
  assert.ok((await workspace.closeFolder()).ok);
  const snapshot = workspace.getSnapshot();
  assert.equal(snapshot.folder.state.status, "none");
  assert.equal(snapshot.slots.a.name, "Welcome");
  assert.equal(root.fileAt("AGENTS.md")?.text, "# Agents\nsaved on close\n");
});

// ---------------------------------------------------------------------------
// Letters

const LETTER_A = ".agents/letters/2026-11-24-1700-auth.md";
const LETTER_B = ".agents/letters/2026-11-25-0930-auth.md";
const LETTER_TEXT = "HANDOFF · auth · 2026-11-25\n\nWhere it stands. The migration is done.\n";

async function acceptedPostmark(name: string, text: string): Promise<string> {
  return postmarkJson(
    create(PostmarkSchema, {
      letter: name,
      digest: await letterDigest(new TextEncoder().encode(text)),
      verdict: LetterVerdict.ACCEPTED,
      signer: "Matt",
      sealedAt: timestampFromMs(0),
    }),
  );
}

test("the folder snapshot carries each letter's state", async () => {
  const b = browser();
  const { workspace } = b.open();
  await workspace.start();
  const root = folder(b.volume, {
    [LETTER_A]: LETTER_TEXT,
    [`${LETTER_A}.postmark.json`]: await acceptedPostmark("2026-11-24-1700-auth.md", LETTER_TEXT),
    [LETTER_B]: LETTER_TEXT,
  });
  await workspace.openFolder(asDirectoryHandle(root));
  const { folder: snapshot } = workspace.getSnapshot();
  assert.deepEqual(
    snapshot.letters.map((l) => [l.path, l.state]),
    [
      [LETTER_A, LetterState.ACCEPTED],
      [LETTER_B, LetterState.DRAFT],
    ],
  );
  assert.deepEqual(
    snapshot.files.filter((f) => f.group === "letter").map((f) => f.path),
    [LETTER_A, LETTER_B],
  );
});

test("sealing saves pending edits first, writes the postmark, and reopens the letter read-only", async () => {
  const b = browser({ locks: new FakeLocks() });
  const { workspace } = b.open();
  await workspace.start();
  const root = folder(b.volume, { [LETTER_B]: LETTER_TEXT });
  await workspace.openFolder(asDirectoryHandle(root));
  assert.ok((await workspace.open("a", fileRef(parseFilePath(LETTER_B)))).ok);
  const edited = `${LETTER_TEXT}Next: deploy on Monday.`;
  workspace.edit("a", edited);
  const sealed = await workspace.sealLetter("a", { verdict: "accepted", signer: "Matt" });
  assert.ok(sealed.ok);
  const onDisk = root.fileAt(LETTER_B)?.text ?? "";
  assert.equal(onDisk, `${edited}\n`, "the edit reached the file before the seal");
  assert.equal(sealed.value.digest, await letterDigest(new TextEncoder().encode(onDisk)));
  assert.ok(root.fileAt(`${LETTER_B}.postmark.json`), "the postmark is beside the letter");
  const snapshot = workspace.getSnapshot();
  assert.equal(snapshot.slots.a.readOnly, true);
  assert.equal(snapshot.folder.letters[0]?.state, LetterState.ACCEPTED);
  // Typing into the sealed letter changes nothing and writes nothing.
  workspace.edit("a", "overwritten");
  await b.scheduler.advance(5000);
  assert.equal(workspace.getSnapshot().slots.a.text, edited);
  assert.equal(root.fileAt(LETTER_B)?.text, onDisk);
});

test("a letter sealed in another tab is refused there, and the first postmark stays", async () => {
  const b = browser({ locks: new FakeLocks() });
  const first = b.open();
  const second = b.open();
  await first.workspace.start();
  await second.workspace.start();
  const root = folder(b.volume, { [LETTER_B]: LETTER_TEXT });
  await first.workspace.openFolder(asDirectoryHandle(root));
  await second.workspace.openFolder(asDirectoryHandle(root));
  for (const tab of [first, second]) assert.ok((await tab.workspace.open("a", fileRef(parseFilePath(LETTER_B)))).ok);
  assert.ok((await first.workspace.sealLetter("a", { verdict: "accepted", signer: "Matt" })).ok);
  const postmark = root.fileAt(`${LETTER_B}.postmark.json`)?.text;
  const again = await second.workspace.sealLetter("a", { verdict: "returned", reason: "No", signer: "Ana" });
  assert.equal(again.ok, false);
  assert.ok(!again.ok && again.error instanceof PostmarkExistsError);
  assert.equal(root.fileAt(`${LETTER_B}.postmark.json`)?.text, postmark);
  assert.equal(second.workspace.getSnapshot().slots.a.readOnly, true, "the second tab now shows it sealed");
  assert.equal(second.workspace.getSnapshot().folder.letters[0]?.state, LetterState.ACCEPTED);
});

test("New letter creates timestamped drafts, numbered within a minute, and opens each", async () => {
  const b = browser();
  const { workspace } = b.open();
  await workspace.start();
  const root = folder(b.volume, { "AGENTS.md": "# Agents\n" });
  await workspace.openFolder(asDirectoryHandle(root));
  const one = await workspace.createLetter("HANDOFF · first\n", "a");
  const two = await workspace.createLetter("HANDOFF · second\n", "a");
  assert.ok(one.ok && two.ok);
  assert.match(one.value, /^\.agents\/letters\/\d{4}-\d{2}-\d{2}-\d{4}-letter\.md$/);
  assert.equal(two.value, one.value.replace(/\.md$/, "-2.md"));
  assert.equal(root.fileAt(one.value)?.text, "HANDOFF · first\n");
  assert.equal(workspace.getSnapshot().slots.a.label, two.value);
  assert.deepEqual(
    workspace.getSnapshot().folder.letters.map((l) => [l.path, l.state]),
    [
      [one.value, LetterState.DRAFT],
      [two.value, LetterState.DRAFT],
    ],
  );
});

test("the signer setting trims, and blank reads as unset", () => {
  assert.equal(SETTINGS.signer.codec.parse("  Matt "), "Matt");
  assert.equal(SETTINGS.signer.codec.parse("   "), null);
  assert.equal(SETTINGS.signer.codec.format(null), "");
  assert.equal(readSetting(SETTINGS.signer), null);
});
