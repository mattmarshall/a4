/** Every port the workspace needs, bundled: the browser's (browser.ts) or a test's fakes (testing/fakes.ts). */

import type { Channel } from "./channel.ts";
import type { Clock } from "./clock.ts";
import type { DeviceStorage } from "./device-storage.ts";
import type { HandleStore } from "./handle-store.ts";
import type { KeyValue } from "./key-value.ts";
import type { Locks } from "./locks.ts";
import type { RandomId } from "./random-id.ts";
import type { TabRegistry } from "./tabs.ts";

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
