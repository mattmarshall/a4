"use client";

/**
 * A setting as React state: the stored value (the default while prerendering
 * and before the first client render), and a setter that stores it. Every
 * component using the same setting in this tab sees the change.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { snapshotReader, subscribeSettings, writeSetting, type Setting } from "@/lib/settings";

export function useSetting<T>(setting: Setting<T>): [T, (value: T) => void] {
  const read = useMemo(() => snapshotReader(setting), [setting]);
  const value = useSyncExternalStore(subscribeSettings, read, () => setting.default);
  const set = useCallback((next: T) => writeSetting(setting, next), [setting]);
  return [value, set];
}
