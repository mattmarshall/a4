/**
 * The contract every PluginStore keeps, as a list of named checks. Node runs
 * them against MemoryPluginStore (plugin-store.test.ts); the browser runs
 * them against IdbPluginStore, which Node can't, from the dev console:
 * `(await import("/lib/platform/testing/plugin-store-contract.ts")).runInBrowser()`.
 */

import { IdbPluginStore, type PluginStore } from "../plugin-store.ts";

const bytes = (...values: number[]) => new Uint8Array(values);

function same(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export const PLUGIN_STORE_CONTRACT: readonly [string, (store: PluginStore) => Promise<void>][] = [
  [
    "a record reads back byte for byte, and records lists it",
    async (store) => {
      await store.putRecord("example.word-length", bytes(1, 2, 3));
      check(same(await store.getRecord("example.word-length"), bytes(1, 2, 3)), "record didn't read back");
      const all = await store.records();
      check(all.length === 1 && all[0]?.[0] === "example.word-length", "records didn't list it");
    },
  ],
  [
    "a missing record and a missing file are null",
    async (store) => {
      check((await store.getRecord("nope")) === null, "missing record isn't null");
      check((await store.getFile("urn:sha256:00")) === null, "missing file isn't null");
    },
  ],
  [
    "putting a record again replaces it, and deleting removes it",
    async (store) => {
      await store.putRecord("a", bytes(1));
      await store.putRecord("a", bytes(2));
      check(same(await store.getRecord("a"), bytes(2)), "record wasn't replaced");
      await store.deleteRecord("a");
      check((await store.getRecord("a")) === null, "record wasn't deleted");
      check((await store.records()).length === 0, "records still lists it");
    },
  ],
  [
    "files are kept by digest, apart from records, and changing the bytes put doesn't change the stored copy",
    async (store) => {
      const data = bytes(9, 9, 9);
      await store.putFile("urn:sha256:aa", data);
      data[0] = 0;
      check(same(await store.getFile("urn:sha256:aa"), bytes(9, 9, 9)), "file changed with the caller's buffer");
      check((await store.records()).length === 0, "a file showed up as a record");
      await store.deleteFile("urn:sha256:aa");
      check((await store.getFile("urn:sha256:aa")) === null, "file wasn't deleted");
    },
  ],
];

/**
 * Run the contract against a fresh IndexedDB database; resolves with each
 * check's outcome. Called by hand from the dev console, so nothing imports it.
 *
 * @public
 */
export async function runInBrowser(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, run] of PLUGIN_STORE_CONTRACT) {
    const dbName = `a4-plugins-contract-${crypto.randomUUID()}`;
    try {
      await run(new IdbPluginStore(dbName));
      out[name] = "pass";
    } catch (error) {
      out[name] = `FAIL: ${(error as Error).message}`;
    } finally {
      indexedDB.deleteDatabase(dbName);
    }
  }
  return out;
}
