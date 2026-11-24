import { usableLocalStorage } from "./key-value.ts";

/** The browser's storage: the origin private file system, persistence, and localStorage. */
export interface DeviceStorage {
  /** The OPFS root, or null when this browser can't write OPFS files. */
  opfsRoot(): Promise<FileSystemDirectoryHandle> | null;
  /** localStorage when writing to it works, else null. */
  localStorage(): Storage | null;
  /** Whether storage is persistent, or null when the browser can't say. */
  persisted(): Promise<boolean | null>;
  /** Ask for persistent storage; null when the browser can't. */
  persist(): Promise<boolean | null>;
}

function opfsWritable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.storage?.getDirectory === "function" &&
    typeof FileSystemFileHandle !== "undefined" &&
    "createWritable" in FileSystemFileHandle.prototype
  );
}

export function browserStorage(): DeviceStorage {
  return {
    opfsRoot: () => (opfsWritable() ? navigator.storage.getDirectory() : null),
    localStorage: usableLocalStorage,
    async persisted() {
      try {
        return (await navigator.storage?.persisted?.()) ?? null;
      } catch {
        return null;
      }
    },
    async persist() {
      try {
        return (await navigator.storage?.persist?.()) ?? null;
      } catch {
        return null;
      }
    },
  };
}
