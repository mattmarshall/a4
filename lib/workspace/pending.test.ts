import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePageName } from "../store/names.ts";
import { fileRef, libraryRef, parseFilePath } from "../store/refs.ts";
import { shouldReopen } from "./pending.ts";

const file = fileRef(parseFilePath("AGENTS.md"));
const welcome = libraryRef(parsePageName("Welcome"));
const charter = libraryRef(parsePageName("Charter"));

test("a remembered file reopens only while its slot still shows the fallback", () => {
  assert.equal(shouldReopen("a", { ref: file, fallback: welcome }, welcome), true);
  assert.equal(shouldReopen("a", { ref: file, fallback: welcome }, charter), false);
  assert.equal(shouldReopen("b", { ref: file, fallback: welcome }, welcome), true);
  assert.equal(shouldReopen("b", { ref: file, fallback: welcome }, null), false);
});

test("with no fallback, A reopens when empty; B waits for Compare", () => {
  assert.equal(shouldReopen("a", { ref: file, fallback: null }, null), true);
  assert.equal(shouldReopen("a", { ref: file, fallback: null }, charter), false);
  assert.equal(shouldReopen("b", { ref: file, fallback: null }, null), false);
});
