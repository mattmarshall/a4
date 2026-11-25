import { test } from "node:test";
import assert from "node:assert/strict";
import { type FolderFs, isFsError } from "./fs.ts";
import { browserFixture, type FolderFixture, nodeFixture, type TestFolder } from "./testing/fixtures.ts";

const bytes = (text: string) => new TextEncoder().encode(text);

/** The write tests, on one folder adapter. */
function suite<H>(label: string, makeFixture: () => Promise<FolderFixture<H>>) {
  const inFolder = async (
    files: Record<string, string>,
    run: (fs: FolderFs, folder: TestFolder<H>) => Promise<void>,
  ): Promise<void> => {
    const fixture = await makeFixture();
    try {
      const folder = await fixture.folder("repo", files);
      await run(fixture.source.open(folder.handle), folder);
    } finally {
      await fixture.dispose();
    }
  };

  test(`${label}: an exclusive write creates a new file and its folders`, async () => {
    await inFolder({}, async (fs, folder) => {
      const written = await fs.writeAtomic(".agents/letters/new.md", bytes("hello\n"), { exclusive: true });
      assert.equal(written.size, 6);
      assert.equal(await folder.text(".agents/letters/new.md"), "hello\n");
    });
  });

  test(`${label}: an exclusive write never replaces an existing file`, async () => {
    await inFolder({ "AGENTS.md": "first\n" }, async (fs, folder) => {
      const before = await fs.stat("AGENTS.md");
      await assert.rejects(fs.writeAtomic("AGENTS.md", bytes("second\n"), { create: true, exclusive: true }), (error) =>
        isFsError(error, "exists"),
      );
      assert.equal(await folder.text("AGENTS.md"), "first\n");
      assert.deepEqual(await fs.stat("AGENTS.md"), before);
      const writes = folder.writes("AGENTS.md");
      if (writes !== null) assert.equal(writes, 0);
    });
  });

  test(`${label}: a write without exclusive still replaces the file`, async () => {
    await inFolder({ "AGENTS.md": "first\n" }, async (fs, folder) => {
      await fs.writeAtomic("AGENTS.md", bytes("second\n"), { create: true });
      assert.equal(await folder.text("AGENTS.md"), "second\n");
    });
  });
}

suite("browser", async () => browserFixture());
suite("node", nodeFixture);
