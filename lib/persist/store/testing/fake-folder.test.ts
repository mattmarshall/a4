import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeDirectoryHandle, FakeVolume } from "./fake-opfs.ts";

const named = (name: string) => (error: unknown) => (error as { name?: string }).name === name;

test("files hold exact bytes, including invalid UTF-8 and a byte-order mark", async () => {
  const root = new FakeDirectoryHandle("repo");
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0xff, 0x0d, 0x0a]);
  root.put("docs/notes.md", bytes);
  const handle = await (await root.getDirectoryHandle("docs")).getFileHandle("notes.md");
  const file = await handle.getFile();
  assert.equal(file.size, 7);
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
});

test("writes commit on close and are counted", async () => {
  let now = 1000;
  const root = new FakeDirectoryHandle("repo", new FakeVolume(() => now));
  const file = root.put("AGENTS.md", "v1", 1);
  now = 2000;
  const writable = await file.createWritable();
  await writable.write("v2\r\n");
  assert.equal(file.text, "v1");
  await writable.close();
  assert.equal(file.text, "v2\r\n");
  assert.equal(file.writes, 1);
  assert.equal((await file.getFile()).lastModified, 2000);
});

test("permission states: prompt, then granted or denied by the user", async () => {
  const volume = new FakeVolume();
  const root = new FakeDirectoryHandle("repo", volume);
  root.put("AGENTS.md", "x");
  volume.permission = "prompt";
  assert.equal(await root.queryPermission({ mode: "readwrite" }), "prompt");
  await assert.rejects(root.getFileHandle("AGENTS.md"), named("NotAllowedError"));
  assert.equal(await root.requestPermission({ mode: "readwrite" }), "granted");
  assert.equal(volume.prompts, 1);
  assert.equal((await (await root.getFileHandle("AGENTS.md")).getFile()).size, 1);

  volume.permission = "prompt";
  volume.grantOnRequest = false;
  assert.equal(await root.requestPermission({ mode: "readwrite" }), "denied");
});

test("removed entries throw NotFoundError through existing handles", async () => {
  const parent = new FakeDirectoryHandle("");
  const root = await parent.getDirectoryHandle("repo", { create: true });
  const file = root.put("AGENTS.md", "x");
  root.remove("AGENTS.md");
  await assert.rejects(file.getFile(), named("NotFoundError"));
  await assert.rejects(root.getFileHandle("AGENTS.md"), named("NotFoundError"));

  root.put(".claude/skills/review/SKILL.md", "y");
  await parent.removeEntry("repo", { recursive: true });
  await assert.rejects(root.queryPermission(), named("NotFoundError"));
  await assert.rejects(
    (async () => {
      for await (const _ of root.entries()) void _;
    })(),
    named("NotFoundError"),
  );
});

test("put creates nested folders, and handles compare by identity", async () => {
  const root = new FakeDirectoryHandle("repo");
  const file = root.put(".claude/skills/review/SKILL.md", "skill");
  assert.equal(root.fileAt(".claude/skills/review/SKILL.md"), file);
  assert.ok(await root.isSameEntry(root));
  assert.ok(!(await root.isSameEntry(new FakeDirectoryHandle("repo"))));
});
