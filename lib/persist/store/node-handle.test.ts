import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inProcessLocks } from "../../platform/locks.ts";
import { parsePageName } from "./names.ts";
import { nodeDirectory } from "./node-handle.ts";
import { OpfsPageStore } from "./opfs.ts";
import { pageStoreContract } from "./testing/contract.ts";

const folders: string[] = [];
after(async () => {
  for (const folder of folders) await rm(folder, { recursive: true, force: true });
});

async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "a4-served-"));
  folders.push(dir);
  return dir;
}

const served = async (dir: string, locks = inProcessLocks()) =>
  OpfsPageStore.open(await nodeDirectory(dir), { locks, appDir: null });

pageStoreContract("OPFS store over a Node folder (a4 serve)", async () => served(await folder()), {
  tabs: async () => {
    const dir = await folder();
    const locks = inProcessLocks();
    return [await served(dir, locks), await served(dir, locks)] as const;
  },
});

test("a page is exactly <folder>/pages/<name>.md, and trash is <folder>/trash/", async () => {
  const dir = await folder();
  const store = await served(dir);
  await store.create(parsePageName("Brief"), "Ship Friday.");
  assert.equal(await readFile(join(dir, "pages", "Brief.md"), "utf8"), "Ship Friday.");
  await store.trash(parsePageName("Brief"));
  assert.deepEqual(await readdir(join(dir, "pages")), []);
  assert.equal((await readdir(join(dir, "trash"))).length, 1);
});

test("a file written on disk is the next read's text", async () => {
  const dir = await folder();
  const store = await served(dir);
  await store.create(parsePageName("Brief"), "v1");
  await writeFile(join(dir, "pages", "Brief.md"), "v2 from an agent\n");
  assert.equal((await store.read(parsePageName("Brief"))).text, "v2 from an agent\n");
  await writeFile(join(dir, "pages", "Notes.md"), "made on disk");
  assert.deepEqual((await store.list()).map((p) => p.name).sort(), ["Brief", "Notes"]);
});

test("in-process locks run one request per name at a time, and a failure doesn't block the next", async () => {
  const locks = inProcessLocks();
  const order: string[] = [];
  const slow = locks.request("a", async () => {
    order.push("a1 start");
    await new Promise((r) => setTimeout(r, 20));
    order.push("a1 end");
  });
  const other = locks.request("b", async () => {
    order.push("b");
  });
  const failing = locks.request("a", async () => {
    order.push("a2");
    throw new Error("boom");
  });
  const after = locks.request("a", async () => {
    order.push("a3");
  });
  await Promise.all([slow, other, failing.catch(() => {}), after]);
  assert.deepEqual(order, ["a1 start", "b", "a1 end", "a2", "a3"]);
});
