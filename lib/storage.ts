/**
 * Guarded browser storage. Each setting is a separate scalar string key, so no
 * structured record is serialized. Every access tolerates blocked or missing
 * storage (private windows, disabled site data, server rendering).
 */

const PREFIX = "a4:";

export const KEYS = {
  textA: "text:a",
  textB: "text:b",
  preset: "preset",
  lens: "lens",
  grid: "grid",
  mode: "mode",
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
