/**
 * Guarded browser storage for settings. Each setting is a separate scalar
 * string key, so no structured record is serialized. Every access tolerates
 * blocked or missing storage (private windows, disabled site data, server
 * rendering). Page text is not stored here; see lib/store.
 */

import { MemoryKeyValue, StorageKeyValue, type KeyValue } from "./store/key-value.ts";

const PREFIX = "a4:";

export const KEYS = {
  preset: "preset",
  lens: "lens",
  grid: "grid",
  mode: "mode",
  render: "render",
  openA: "open:a",
  openB: "open:b",
  library: "library",
  inspector: "inspector",
} as const;

export function readKey(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(PREFIX + key) ?? null;
  } catch {
    return null;
  }
}

export function writeKey(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(PREFIX + key, value);
  } catch {
    // Storage unavailable: keep working in memory.
  }
}

/** localStorage as a KeyValue, or an in-memory stand-in when it is unusable. */
export function browserKeyValue(): KeyValue {
  try {
    const storage = globalThis.localStorage;
    if (storage) {
      storage.setItem("a4:probe", "1");
      storage.removeItem("a4:probe");
      return new StorageKeyValue(storage);
    }
  } catch {
    // fall through
  }
  return new MemoryKeyValue();
}
