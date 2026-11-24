/**
 * Which tabs are open, so startup recovers only drafts from tabs that are
 * gone. In the browser, each tab holds a Web Lock named `a4:tab:<id>` for
 * its lifetime.
 */

export interface TabRegistry {
  /** Hold this tab's lock for the page's lifetime. */
  hold(tabId: string): void;
  /** The ids of all live tabs, or null when that can't be known. */
  live(): Promise<ReadonlySet<string> | null>;
}

const PREFIX = "a4:tab:";

/** Liveness unknown: recovery then waits until drafts are stale. */
export const unknownTabs: TabRegistry = {
  hold: () => {},
  live: async () => null,
};

export function browserTabs(): TabRegistry {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) return unknownTabs;
  return {
    hold(tabId) {
      void locks.request(`${PREFIX}${tabId}`, () => new Promise<void>(() => {}));
    },
    async live() {
      try {
        const snapshot = await locks.query();
        const names = [...(snapshot.held ?? []), ...(snapshot.pending ?? [])].map((l) => l.name ?? "");
        return new Set(names.filter((n) => n.startsWith(PREFIX)).map((n) => n.slice(PREFIX.length)));
      } catch {
        return null;
      }
    },
  };
}
