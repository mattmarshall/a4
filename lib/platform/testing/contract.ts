/**
 * What the browser store contracts share: a check that throws, and the loop
 * that runs each named check against a store on a fresh IndexedDB database.
 * Each contract's own `runInBrowser()` calls it from the dev console.
 */

/** Throws `message` unless `condition` holds. */
export function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/**
 * Runs each check against a store that `open` makes on its own database,
 * named `<prefix>-<uuid>`: runs the check, closes the store, records "pass"
 * or "FAIL: <why>", and deletes the database. Resolves with each check's
 * outcome.
 */
export async function runEach<S extends { close(): void }>(
  checks: readonly (readonly [string, (store: NoInfer<S>) => Promise<void>])[],
  prefix: string,
  open: (dbName: string) => S,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, run] of checks) {
    const dbName = `${prefix}-${crypto.randomUUID()}`;
    try {
      const store = open(dbName);
      try {
        await run(store);
      } finally {
        store.close();
      }
      out[name] = "pass";
    } catch (error) {
      out[name] = `FAIL: ${(error as Error).message}`;
    } finally {
      indexedDB.deleteDatabase(dbName);
    }
  }
  return out;
}
