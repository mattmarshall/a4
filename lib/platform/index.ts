/**
 * Platform ports: everything A4's core reads from the browser, behind small
 * interfaces. Only this folder touches `Date.now`, `crypto`, `indexedDB`,
 * `navigator`, `localStorage`, or `BroadcastChannel` (Biome enforces it, see
 * biome.json). Browser adapters are in `browser.ts`; fakes for Node tests are
 * in `testing/`.
 */

import type { Channel } from "./channel.ts";
import type { Clock } from "./clock.ts";
import type { DeviceStorage } from "./device-storage.ts";
import type { HandleStore } from "./handle-store.ts";
import type { KeyValue } from "./key-value.ts";
import type { Locks } from "./locks.ts";
import type { RandomId } from "./random-id.ts";
import type { TabRegistry } from "./tabs.ts";

export type { Channel } from "./channel.ts";
export { systemClock, type Clock } from "./clock.ts";
export type { DeviceStorage } from "./device-storage.ts";
export { IdbHandleStore, MemoryHandleStore, type HandleStore } from "./handle-store.ts";
export { MemoryKeyValue, StorageKeyValue, type KeyValue } from "./key-value.ts";
export { noLocks, type Locks } from "./locks.ts";
export { randomId, type RandomId } from "./random-id.ts";
export { unknownTabs, type TabRegistry } from "./tabs.ts";

/** Every port, as the workspace receives them. */
export interface Platform {
  readonly clock: Clock;
  /** Web Locks, or null without them (one tab at a time is then assumed safe). */
  readonly locks: Locks | null;
  /** Settings and draft storage. */
  readonly keyValue: KeyValue;
  readonly randomId: RandomId;
  readonly handles: HandleStore;
  readonly tabs: TabRegistry;
  readonly storage: DeviceStorage;
  /** A channel to this origin's other tabs, or null without one. */
  channel(name: string): Channel | null;
  /** False when the browser has no folder picker. */
  readonly folderPicker: boolean;
}
