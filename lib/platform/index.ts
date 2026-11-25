/**
 * Platform ports: everything A4's core reads from the browser, behind small
 * interfaces. Only this folder touches `Date.now`, `crypto`, `indexedDB`,
 * `navigator`, `localStorage`, or `BroadcastChannel` (Biome enforces it, see
 * biome.json). Browser adapters are in `browser.ts`; fakes for Node tests are
 * in `testing/`.
 */

export type { Channel } from "./channel.ts";
export { systemClock, type Clock } from "./clock.ts";
export type { DeviceStorage } from "./device-storage.ts";
export { sha256 } from "./digest.ts";
export { IdbHandleStore, MemoryHandleStore, type HandleStore } from "./handle-store.ts";
export { MemoryKeyValue, StorageKeyValue, type KeyValue } from "./key-value.ts";
export { noLocks, type Locks } from "./locks.ts";
export { randomId, type RandomId } from "./random-id.ts";
export { unknownTabs, type TabRegistry } from "./tabs.ts";

export { browserPlatform } from "./browser.ts";
export type { Platform } from "./platform.ts";
