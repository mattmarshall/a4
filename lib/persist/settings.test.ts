import { test } from "node:test";
import assert from "node:assert/strict";
import {
  choiceCodec,
  flagCodec,
  inspectorSection,
  modeCodec,
  readSetting,
  SETTINGS,
  setSettingsStorage,
  settingValue,
  snapshotReader,
  subscribeSettings,
  writeSetting,
} from "./settings.ts";
import { MemoryKeyValue, type KeyValue } from "../platform/key-value.ts";
import { parseFilePath } from "./store/refs.ts";
import { parsePageName } from "./store/names.ts";

/** A fresh settings store with `entries`, returned for assertions. */
function installStorage(entries: Record<string, string> = {}) {
  const kv = new MemoryKeyValue();
  for (const [key, value] of Object.entries(entries)) kv.set(key, value);
  setSettingsStorage(kv);
  return { get: (key: string) => kv.get(key) ?? undefined };
}

test("codecs read what earlier versions stored", () => {
  assert.equal(modeCodec.parse("compare"), "compare");
  assert.equal(modeCodec.parse("paper"), "single", "the old 3D mode reads as single");
  assert.equal(modeCodec.parse("triple"), null);
  assert.equal(flagCodec.parse("1"), true);
  assert.equal(flagCodec.parse("0"), false);
  assert.equal(flagCodec.format(true), "1");
  const presets = choiceCodec(["terminal", "dense"] as const);
  assert.equal(presets.parse("dense"), "dense");
  assert.equal(presets.parse("toString"), null);
});

test("stored values are read through the registry, with defaults for bad ones", () => {
  installStorage({
    "a4:mode": "paper",
    "a4:preset": "elite",
    "a4:lens": "sparkle",
    "a4:open:a": "file:docs/AGENTS.md",
    "a4:open:b": "",
  });
  assert.equal(readSetting(SETTINGS.mode), "single");
  assert.equal(readSetting(SETTINGS.preset), "elite");
  assert.equal(readSetting(SETTINGS.lens), null);
  assert.equal(settingValue(SETTINGS.lens), "ink");
  assert.deepEqual(readSetting(SETTINGS.openA), { kind: "file", path: parseFilePath("docs/AGENTS.md") });
  assert.equal(readSetting(SETTINGS.openB), null);
  assert.equal(readSetting(SETTINGS.grid), null, "unset");
});

test("writes keep the stored format, and notify this tab", () => {
  const map = installStorage();
  let calls = 0;
  const stop = subscribeSettings(() => calls++);
  writeSetting(SETTINGS.grid, true);
  writeSetting(SETTINGS.grid, true);
  writeSetting(SETTINGS.openB, { kind: "library", name: parsePageName("Brief") });
  writeSetting(inspectorSection("shape", false), true);
  stop();
  writeSetting(SETTINGS.render, "flat");
  assert.equal(map.get("a4:grid"), "1");
  assert.equal(map.get("a4:open:b"), "Brief");
  assert.equal(map.get("a4:inspector:shape"), "1");
  assert.equal(map.get("a4:render"), "flat");
  assert.equal(calls, 3, "an unchanged value isn't announced, and unsubscribing stops calls");
});

test("without storage, a session still keeps its settings", () => {
  const blocked: KeyValue = {
    get() {
      throw new Error("blocked");
    },
    set() {
      throw new Error("blocked");
    },
    remove() {},
    keys: () => [],
  };
  setSettingsStorage(blocked);
  const section = inspectorSection("models", false);
  assert.equal(settingValue(section), false);
  writeSetting(section, true);
  assert.equal(settingValue(section), true);
});

test("a snapshot is the same object until the stored value changes", () => {
  installStorage();
  writeSetting(SETTINGS.openA, { kind: "library", name: parsePageName("Plan") });
  const read = snapshotReader(SETTINGS.openA);
  const first = read();
  assert.equal(read(), first);
  writeSetting(SETTINGS.openA, { kind: "library", name: parsePageName("Other") });
  assert.notEqual(read(), first);
  assert.deepEqual(read(), { kind: "library", name: "Other" });
});
