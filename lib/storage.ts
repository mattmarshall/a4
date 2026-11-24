/**
 * Guarded browser storage: localStorage as a `KeyValue` (the edit journal's
 * home), tolerating blocked or missing storage (private windows, disabled
 * site data, server rendering). Settings live in lib/settings.ts; page text
 * in lib/store.
 */

import { MemoryKeyValue, StorageKeyValue, type KeyValue } from "./store/key-value.ts";

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
