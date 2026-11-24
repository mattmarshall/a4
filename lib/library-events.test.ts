import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeLibraryEvent, encodeLibraryEvent, pageSaved, pagesChanged } from "./library-events.ts";

test("library events round-trip as bytes", () => {
  const saved = decodeLibraryEvent(encodeLibraryEvent(pageSaved("Brief")));
  assert.equal(saved?.event.case, "pageSaved");
  assert.equal(saved?.event.case === "pageSaved" ? saved.event.value.name : null, "Brief");
  assert.equal(decodeLibraryEvent(encodeLibraryEvent(pagesChanged()))?.event.case, "pagesChanged");
});

test("the old string messages still decode, for one release", () => {
  assert.equal(decodeLibraryEvent("")?.event.case, "pagesChanged");
  const legacy = decodeLibraryEvent("Brief");
  assert.equal(legacy?.event.case === "pageSaved" ? legacy.event.value.name : null, "Brief");
});

test("anything else is ignored", () => {
  assert.equal(decodeLibraryEvent(42), null);
  assert.equal(decodeLibraryEvent({ name: "Brief" }), null);
  assert.equal(decodeLibraryEvent(new Uint8Array([0xff, 0xff, 0xff])), null);
});
