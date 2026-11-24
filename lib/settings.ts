/**
 * Settings: each one is a `Setting<T>` with its storage key, a codec, and a
 * default, declared once in `SETTINGS`. Nothing else knows the key strings.
 *
 * Every setting is a separate scalar key (`a4:<key>`) in the KeyValue port
 * (localStorage in the browser), so no structured record is serialized, and
 * keys and values are the ones earlier versions wrote. Access tolerates
 * blocked or missing storage (private windows, disabled site data, server
 * rendering): writes this tab makes are kept in memory too, so the session
 * keeps working without storage.
 *
 * Changes are announced to this tab's subscribers (`subscribeSettings`), so
 * `useSetting` re-renders; other tabs read the new value the next time they
 * load, as before.
 */

import { browserKeyValue, type KeyValue } from "./platform/key-value.ts";
import { pageRefCodec } from "./store/refs.ts";
import { DEFAULT_PRESET, PRESET_ORDER, type PresetId } from "./page-spec.ts";
import { LENSES, type LensId } from "./lenses.ts";
import type { IdCodec } from "./store/types.ts";
import type { PageRef } from "./store/refs.ts";

export interface Setting<T> {
  /** The storage key, without the `a4:` prefix. */
  readonly key: string;
  /** Reads a stored string (null when it isn't a valid value) and writes one. */
  readonly codec: IdCodec<T>;
  readonly default: T;
}

export function defineSetting<T>(setting: Setting<T>): Setting<T> {
  return setting;
}

// ---------------------------------------------------------------------------
// Codecs

/** One of `values`, stored as itself. */
export function choiceCodec<T extends string>(values: readonly T[]): IdCodec<T> {
  return {
    parse: (raw) => values.find((v) => v === raw) ?? null,
    format: (value) => value,
  };
}

/** A boolean stored as "1" or "0"; any other stored value reads as false. */
export const flagCodec: IdCodec<boolean> = {
  parse: (raw) => raw === "1",
  format: (value) => (value ? "1" : "0"),
};

export type Mode = "single" | "compare";

/** The workspace mode. "paper" was the old separate 3D mode; it reads as "single". */
export const modeCodec: IdCodec<Mode> = {
  parse: (raw) => {
    if (raw === "single" || raw === "compare") return raw;
    return raw === "paper" ? "single" : null;
  },
  format: (mode) => mode,
};

/** An open page, as `encodeRef` stores it ("" for none). */
const openRefCodec: IdCodec<PageRef | null> = {
  parse: (raw) => pageRefCodec.parse(raw),
  format: (ref) => (ref ? pageRefCodec.format(ref) : ""),
};

// ---------------------------------------------------------------------------
// The registry

export const SETTINGS = {
  preset: defineSetting<PresetId>({ key: "preset", codec: choiceCodec(PRESET_ORDER), default: DEFAULT_PRESET }),
  lens: defineSetting<LensId>({ key: "lens", codec: choiceCodec(LENSES.map((l) => l.id)), default: "ink" }),
  grid: defineSetting({ key: "grid", codec: flagCodec, default: false }),
  mode: defineSetting<Mode>({ key: "mode", codec: modeCodec, default: "single" }),
  render: defineSetting<"3d" | "flat">({ key: "render", codec: choiceCodec(["3d", "flat"]), default: "3d" }),
  /** The Pages panel (stored as "library", as earlier versions did). Unset means "decide by window width". */
  pagesPanel: defineSetting({ key: "library", codec: flagCodec, default: true }),
  /** The inspector. Unset means "decide by window width". */
  inspector: defineSetting({ key: "inspector", codec: flagCodec, default: true }),
  openA: defineSetting({ key: "open:a", codec: openRefCodec, default: null }),
  openB: defineSetting({ key: "open:b", codec: openRefCodec, default: null }),
} as const;

/** Whether the inspector section `id` is open; `defaultOpen` until the user toggles it. */
export function inspectorSection(id: string, defaultOpen: boolean): Setting<boolean> {
  return { key: `inspector:${id}`, codec: flagCodec, default: defaultOpen };
}

// ---------------------------------------------------------------------------
// Storage

const PREFIX = "a4:";
/** This tab's writes, so settings work in a session even when storage doesn't. */
const memory = new Map<string, string>();
const listeners = new Set<() => void>();
let storage: KeyValue | null = null;

/** Where settings are stored: the workspace's KeyValue port (localStorage until it sets one). */
export function setSettingsStorage(kv: KeyValue): void {
  storage = kv;
  memory.clear();
}

function store(): KeyValue {
  storage ??= browserKeyValue();
  return storage;
}

function readRaw(key: string): string | null {
  const own = memory.get(key);
  if (own !== undefined) return own;
  try {
    return store().get(PREFIX + key);
  } catch {
    return null;
  }
}

/** The stored value, or null when the setting is unset or its stored value is invalid. */
export function readSetting<T>(setting: Setting<T>): T | null {
  const raw = readRaw(setting.key);
  return raw === null ? null : setting.codec.parse(raw);
}

/** The stored value, or the default. */
export function settingValue<T>(setting: Setting<T>): T {
  return readSetting(setting) ?? setting.default;
}

export function writeSetting<T>(setting: Setting<T>, value: T): void {
  const raw = setting.codec.format(value);
  if (readRaw(setting.key) === raw) return;
  memory.set(setting.key, raw);
  try {
    store().set(PREFIX + setting.key, raw);
  } catch {
    // Storage unavailable: the in-memory copy keeps this session working.
  }
  for (const listener of listeners) listener();
}

/** Call `listener` whenever this tab writes a setting. Returns the unsubscribe. */
export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * A reader of `setting` that returns the same value until the stored string
 * changes, as `useSyncExternalStore` requires of a snapshot.
 */
export function snapshotReader<T>(setting: Setting<T>): () => T {
  let last: { raw: string | null; value: T } | null = null;
  return () => {
    const raw = readRaw(setting.key);
    if (last && last.raw === raw) return last.value;
    const value = raw === null ? setting.default : (setting.codec.parse(raw) ?? setting.default);
    last = { raw, value };
    return value;
  };
}
