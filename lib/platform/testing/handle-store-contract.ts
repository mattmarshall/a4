/**
 * The contract every HandleStore keeps, as a list of named checks over two
 * distinct handles. Node runs them against MemoryHandleStore
 * (handle-store.test.ts); the browser runs them against IdbHandleStore, which
 * Node can't, from the dev console:
 * `(await import("/lib/platform/testing/handle-store-contract.ts")).runInBrowser()`.
 */

import { type HandleStore, IdbHandleStore } from "../handle-store.ts";

/** Two handles, and how to tell whether a handle read back is the one stored. */
interface ContractHandles<H> {
  readonly a: H;
  readonly b: H;
  readonly same: (x: H | null, y: H) => Promise<boolean>;
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

type Check = <H>(store: HandleStore<H>, handles: ContractHandles<H>) => Promise<void>;

export const HANDLE_STORE_CONTRACT: readonly [string, Check][] = [
  [
    "a handle reads back as the same folder, and a missing id is null",
    async (store, { a, same }) => {
      await store.set("one", a);
      check(await same(await store.get("one"), a), "the handle didn't read back");
      check((await store.get("nope")) === null, "a missing id isn't null");
    },
  ],
  [
    "setting an id again replaces its handle, and deleting removes it",
    async (store, { a, b, same }) => {
      await store.set("one", a);
      await store.set("one", b);
      check(await same(await store.get("one"), b), "the handle wasn't replaced");
      await store.delete("one");
      check((await store.get("one")) === null, "the handle wasn't deleted");
    },
  ],
  [
    "entries lists every id with its handle",
    async (store, { a, b, same }) => {
      await store.set("one", a);
      await store.set("two", b);
      const all = new Map(await store.entries());
      check(all.size === 2, `entries listed ${all.size} ids`);
      check(await same(all.get("one") ?? null, a), "entries lost the first handle");
      check(await same(all.get("two") ?? null, b), "entries lost the second handle");
    },
  ],
];

/**
 * Run the contract against a fresh IndexedDB database, with the
 * origin-private file system's root and a folder inside it as the handles;
 * resolves with each check's outcome. Called by hand from the dev console, so
 * nothing imports it.
 *
 * @public
 */
export async function runInBrowser(): Promise<Record<string, string>> {
  const root = await navigator.storage.getDirectory();
  const folder = await root.getDirectoryHandle("a4-handle-contract", { create: true });
  const handles: ContractHandles<FileSystemDirectoryHandle> = {
    a: root,
    b: folder,
    same: async (x, y) => x !== null && (await x.isSameEntry(y)),
  };
  const out: Record<string, string> = {};
  try {
    for (const [name, run] of HANDLE_STORE_CONTRACT) {
      const dbName = `a4-handle-contract-${crypto.randomUUID()}`;
      try {
        await run(new IdbHandleStore(dbName), handles);
        out[name] = "pass";
      } catch (error) {
        out[name] = `FAIL: ${(error as Error).message}`;
      } finally {
        indexedDB.deleteDatabase(dbName);
      }
    }
  } finally {
    await root.removeEntry("a4-handle-contract");
  }
  return out;
}
