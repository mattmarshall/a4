import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryKeyValue, KeyValuePageStore } from "./key-value.ts";
import { pageNameCodec, parsePageName } from "./names.ts";
import { filePathCodec, pageRefCodec, parseFilePath } from "./refs.ts";
import { parseRevision, revisionOf } from "./revision.ts";
import { makeTrashId, parseTrashId } from "./trash-ids.ts";
import { isStoreError, PageConflictError } from "./types.ts";

test("revisions parse back, and anything else is null", () => {
  const revision = revisionOf("hello");
  assert.equal(parseRevision(revision), revision);
  assert.equal(parseRevision(""), null);
  assert.equal(parseRevision("not a revision"), null);
});

test("codecs round-trip, and skip what doesn't parse", () => {
  const path = parseFilePath("docs/AGENTS.md");
  assert.equal(filePathCodec.parse(filePathCodec.format(path)), path);
  assert.equal(filePathCodec.parse("../outside.md"), null);
  assert.equal(pageNameCodec.parse(""), null);
  // Stored names keep names today's rules would reject.
  assert.equal(pageNameCodec.parse(".legacy"), ".legacy");
  const ref = { kind: "file" as const, path };
  assert.deepEqual(pageRefCodec.parse(pageRefCodec.format(ref)), ref);
  assert.equal(pageRefCodec.parse("file:../x.md"), null);
});

test("trash ids carry the name and the time", () => {
  const made = makeTrashId(parsePageName("Notes v2"), 1_000, (id) => id === "Notes v2.1000");
  assert.deepEqual(parseTrashId(made.id), { id: "Notes v2.1001", name: "Notes v2", trashedAt: 1001 });
  assert.deepEqual(parseTrashId("Old page"), { id: "Old page", name: "Old page", trashedAt: 0 });
  assert.equal(parseTrashId(".1234"), null);
});

test("a trash entry that names no page is skipped, not fatal", async () => {
  const kv = new MemoryKeyValue();
  const store = new KeyValuePageStore(kv);
  await store.create(parsePageName("Kept"), "x");
  await store.trash(parsePageName("Kept"));
  kv.set("a4:trash:.1234", "orphaned bytes");
  const trash = await store.listTrash();
  assert.deepEqual(
    trash.map((t) => t.name),
    ["Kept"],
  );
});

test("isStoreError narrows to the error's class", () => {
  const error: unknown = new PageConflictError("Brief", revisionOf("a"), null);
  assert.ok(isStoreError(error, "conflict"));
  // Narrowed: the conflict's fields are typed without a cast.
  assert.equal(error.actual, null);
  assert.equal(error.page, "Brief");
  assert.equal(isStoreError(error, "not-found"), false);
});
