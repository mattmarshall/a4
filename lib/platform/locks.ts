/** The part of the Web Locks API A4 uses: run `fn` while holding the lock `name`. */
export interface Locks {
  request<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

/** No locking: for one tab, tests, and browsers without Web Locks. */
export const noLocks: Locks = { request: (_name, fn) => fn() };

/** The browser's Web Locks, or null when it has none. */
export function browserLocks(): Locks | null {
  return typeof navigator !== "undefined" && navigator.locks ? navigator.locks : null;
}

/**
 * Locks for one process with no Web Locks (the `a4 serve` server): requests
 * for the same name run one at a time, in order, and requests for different
 * names don't wait for each other. A request that fails doesn't block the next.
 */
export function inProcessLocks(): Locks {
  const tails = new Map<string, Promise<unknown>>();
  return {
    request<T>(name: string, fn: () => Promise<T>): Promise<T> {
      const before = tails.get(name) ?? Promise.resolve();
      const result = before.then(fn);
      const tail = result.catch(() => {});
      tails.set(name, tail);
      void tail.then(() => {
        if (tails.get(name) === tail) tails.delete(name);
      });
      return result;
    },
  };
}
