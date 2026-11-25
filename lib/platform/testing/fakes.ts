/**
 * Fakes for every platform port, for Node tests. Time comes from a
 * `FakeScheduler`, so timers and the clock advance together.
 */

import { FakeScheduler } from "../../persist/autosave/testing/fake-scheduler.ts";
import type { Channel } from "../channel.ts";
import type { Clock } from "../clock.ts";
import type { DeviceStorage } from "../device-storage.ts";
import { MemoryHandleStore } from "../handle-store.ts";
import type { Platform } from "../index.ts";
import { MemoryKeyValue } from "../key-value.ts";
import type { Locks } from "../locks.ts";
import type { TabRegistry } from "../tabs.ts";

/**
 * Web Locks within one process, shared by the stores that stand for tabs:
 * each name has one holder at a time, granted in request order.
 */
export class FakeLocks implements Locks {
  readonly #tails = new Map<string, Promise<void>>();
  /** Names held right now, for assertions. */
  readonly held = new Set<string>();

  request<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(name) ?? Promise.resolve();
    let release = () => {};
    const tail = previous.then(() => new Promise<void>((resolve) => (release = resolve)));
    this.#tails.set(name, tail);
    return previous.then(async () => {
      this.held.add(name);
      try {
        return await fn();
      } finally {
        this.held.delete(name);
        release();
        if (this.#tails.get(name) === tail) this.#tails.delete(name);
      }
    });
  }
}

/** A clock that reads a scheduler's time, plus a starting epoch. */
export function schedulerClock(scheduler: FakeScheduler, epoch = 1_800_000_000_000): Clock {
  return { now: () => epoch + scheduler.now };
}

/** Channels between fake tabs: a message one tab posts reaches every other tab's channel of that name. */
export class ChannelHub {
  readonly #channels = new Map<string, Set<(data: unknown) => void>>();

  open(name: string): Channel {
    const listeners = this.#channels.get(name) ?? new Set();
    this.#channels.set(name, listeners);
    const own = new Set<(data: unknown) => void>();
    let closed = false;
    return {
      post: (message) => {
        if (closed) return;
        for (const listener of listeners) if (!own.has(listener)) queueMicrotask(() => listener(message.slice()));
      },
      subscribe: (listener) => {
        own.add(listener);
        listeners.add(listener);
        return () => {
          own.delete(listener);
          listeners.delete(listener);
        };
      },
      close: () => {
        closed = true;
        for (const listener of own) listeners.delete(listener);
        own.clear();
      },
    };
  }
}

/** Tabs that are live until they close. */
export class FakeTabs implements TabRegistry {
  readonly live_ = new Set<string>();
  hold(tabId: string): void {
    this.live_.add(tabId);
  }
  async live(): Promise<ReadonlySet<string>> {
    return new Set(this.live_);
  }
  close(tabId: string): void {
    this.live_.delete(tabId);
  }
}

/** No OPFS and no localStorage: the workspace falls back to memory unless a test provides a store. */
export const memoryOnlyStorage: DeviceStorage = {
  opfsRoot: () => null,
  localStorage: () => null,
  persisted: async () => null,
  persist: async () => null,
};

export interface FakePlatformOptions {
  scheduler?: FakeScheduler;
  keyValue?: MemoryKeyValue;
  tabs?: FakeTabs;
  hub?: ChannelHub;
  handles?: MemoryHandleStore;
  storage?: DeviceStorage;
  /** Shared by tabs of one browser, like Web Locks; none by default. */
  locks?: Locks | null;
}

let counter = 0;

/** A platform for one fake tab; tabs that share `hub`, `keyValue`, `tabs`, and `handles` act like one browser. */
export function fakePlatform(options: FakePlatformOptions = {}): Platform & {
  readonly scheduler: FakeScheduler;
  readonly keyValue: MemoryKeyValue;
  readonly tabs: FakeTabs;
  readonly handles: MemoryHandleStore;
} {
  const scheduler = options.scheduler ?? new FakeScheduler();
  const hub = options.hub ?? new ChannelHub();
  return {
    scheduler,
    clock: schedulerClock(scheduler),
    locks: options.locks ?? null,
    keyValue: options.keyValue ?? new MemoryKeyValue(),
    randomId: () => `fake${(++counter).toString(16).padStart(12, "0")}`,
    handles: options.handles ?? new MemoryHandleStore(),
    tabs: options.tabs ?? new FakeTabs(),
    storage: options.storage ?? memoryOnlyStorage,
    channel: (name) => hub.open(name),
    folderPicker: true,
  };
}
