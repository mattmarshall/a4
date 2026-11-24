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
