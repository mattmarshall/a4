/**
 * Platform ports: everything A4's core reads from the browser, behind small
 * interfaces. Only this folder touches `Date.now`, `crypto`, `indexedDB`,
 * `navigator`, `localStorage`, or `BroadcastChannel` (Biome enforces it, see
 * biome.json). Browser adapters are in `browser.ts`; fakes for Node tests are
 * in `testing/`.
 */

export { browserPlatform } from "./browser.ts";
export { IdbPluginStore } from "./plugin-store.ts";
export type { Platform } from "./platform.ts";
