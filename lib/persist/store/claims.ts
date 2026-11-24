/**
 * Name claims for library backends: pick a free name and act on it while
 * holding that name's lock, so two tabs never claim the same name.
 *
 * A backend supplies `names()`, the names taken now, and `lock(name, fn)`,
 * which holds `name` across tabs (its `a4:page:<lowercased name>` Web Lock, or
 * nothing without Web Locks). The action it runs under the lock checks the
 * name again and throws `PageExistsError` if another caller took it; the
 * claim then moves on to the next variant.
 */

import { nextAvailableName } from "./names.ts";
import { PageExistsError, StoreUnavailableError, type PageName } from "./types.ts";

/** Hold `name`'s lock while `fn` runs. */
export type NameLock = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

/** How many names `claimName` tries before giving up. */
export const MAX_CLAIM_ATTEMPTS = 1000;

/**
 * Run `fn` with `desired`, or the first free variant of it ("Brief 2", …),
 * while holding that name's lock. `fn` must check the name under the lock and
 * throw `PageExistsError` if it's taken, so a name another caller claimed
 * after `names` was read is skipped.
 * @throws StoreUnavailableError after `MAX_CLAIM_ATTEMPTS` names
 */
export async function claimName<T>(
  desired: string,
  backend: { names: () => Promise<Iterable<string>>; lock: NameLock },
  fn: (name: PageName) => Promise<T>,
): Promise<T> {
  const names = new Set(await backend.names());
  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
    const name = nextAvailableName(desired, names);
    try {
      return await backend.lock(name, () => fn(name));
    } catch (error) {
      if (!(error instanceof PageExistsError)) throw error;
      names.add(name);
    }
  }
  throw new StoreUnavailableError(`Couldn’t find a free name for “${desired}”.`);
}

/**
 * Hold every name's lock while `fn` runs, taking them in a fixed order
 * (sorted, lowercased) so two tabs locking the same names can't deadlock.
 * Names equal ignoring case take one lock.
 */
export function lockNames<T>(lock: NameLock, names: readonly string[], fn: () => Promise<T>): Promise<T> {
  const keys = [...new Set(names.map((n) => n.toLocaleLowerCase("en-US")))].sort();
  const hold = (i: number): Promise<T> => {
    const key = keys[i];
    return key === undefined ? fn() : lock(key, () => hold(i + 1));
  };
  return hold(0);
}
