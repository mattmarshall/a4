/** The browser's implementation of every platform port. */

import { browserChannel } from "./channel.ts";
import { systemClock } from "./clock.ts";
import { browserStorage } from "./device-storage.ts";
import { IdbHandleStore } from "./handle-store.ts";
import type { Platform } from "./index.ts";
import { browserKeyValue } from "./key-value.ts";
import { browserLocks } from "./locks.ts";
import { randomId } from "./random-id.ts";
import { browserTabs } from "./tabs.ts";

export function browserPlatform(): Platform {
  return {
    clock: systemClock,
    locks: browserLocks(),
    keyValue: browserKeyValue(),
    randomId,
    handles: new IdbHandleStore(),
    tabs: browserTabs(),
    storage: browserStorage(),
    channel: browserChannel,
    folderPicker: typeof window !== "undefined" && typeof window.showDirectoryPicker === "function",
  };
}
