import assert from "node:assert/strict";
import { test } from "node:test";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  LibraryInfoSchema,
  StoredPageSchema,
  StoredPageSummarySchema,
  StoredTrashEntrySchema,
  StoredWriteSchema,
  StoreErrorCode,
  StoreFailureSchema,
  UnreadableReason,
} from "../../gen/a4/v1/store_pb.js";
import { parsePageName } from "./names.ts";
import { revisionOf } from "./revision.ts";
import { makeTrashId } from "./trash-ids.ts";
import {
  FileUnreadableError,
  InvalidPageNameError,
  InvalidTextError,
  isStoreError,
  PageConflictError,
  PageExistsError,
  PageNotFoundError,
  type PageStoreError,
  StoreUnavailableError,
} from "./types.ts";
import {
  errorFrom,
  failureOf,
  libraryFrom,
  methodByWireName,
  pageWire,
  STORE_PROTOCOL,
  type StoreHandlers,
  summaryWire,
  trashWire,
  wireName,
  writeWire,
} from "./wire.ts";

const name = parsePageName("Brief");
const revision = revisionOf("Ship Friday.");

test("each conversion round-trips through its message", () => {
  const summary = { name, size: 12, modifiedAt: 1764000000000 };
  assert.deepEqual(summaryWire.from(create(StoredPageSummarySchema, summaryWire.to(summary))), summary);
  const page = { name, text: "Ship Friday.", revision, size: 12, modifiedAt: 1764000000000 };
  assert.deepEqual(pageWire.from(create(StoredPageSchema, pageWire.to(page))), page);
  const written = { name, revision, size: 12, modifiedAt: 1764000000000 };
  assert.deepEqual(writeWire.from(create(StoredWriteSchema, writeWire.to(written))), written);
  const { id, trashedAt } = makeTrashId(name, 1764000000000, () => false);
  const entry = { id, name, size: 12, trashedAt };
  assert.deepEqual(trashWire.from(create(StoredTrashEntrySchema, trashWire.to(entry))), entry);
});

test("what the client can't read is a bad answer, never a page", () => {
  const bad = (e: unknown) => isStoreError(e, "unavailable") && e.reason === "bad-answer";
  assert.throws(() => pageWire.from(undefined), bad);
  assert.throws(() => writeWire.from(create(StoredWriteSchema, { name: "Brief", revision: "nope" })), bad);
  // A trash id is any page name (older ids carry no time), so only an empty one names nothing.
  assert.throws(() => trashWire.from(create(StoredTrashEntrySchema, { id: "", name: "Brief" })), bad);
  assert.throws(() => summaryWire.from(create(StoredPageSummarySchema, { name: "" })), bad);
});

/** An error sent as the server sends it, and read back as the client reads it. */
function crossed(error: PageStoreError) {
  const { status, failure } = failureOf(error);
  const wire = fromBinary(StoreFailureSchema, toBinary(StoreFailureSchema, create(StoreFailureSchema, failure)));
  return { status, wire, back: errorFrom(wire) };
}

test("every store error crosses as its own class, with its detail", () => {
  const cases: [PageStoreError, number][] = [
    [new PageNotFoundError("Brief"), 404],
    [new PageExistsError("Brief"), 409],
    [new InvalidPageNameError("a/b", "A page name can’t contain /."), 422],
    [new InvalidTextError("Brief"), 422],
    [new PageConflictError("Brief", revision, revisionOf("Other")), 409],
    [new PageConflictError("Brief", revision, null), 409],
    [new FileUnreadableError("Cafe", "not-utf8"), 422],
    [new FileUnreadableError("Huge", "too-large"), 422],
    [new StoreUnavailableError("The disk is full."), 503],
  ];
  for (const [error, status] of cases) {
    const { status: sent, back } = crossed(error);
    assert.equal(sent, status, error.message);
    assert.equal(back.constructor, error.constructor, error.message);
    assert.equal(back.message, error.message);
    assert.deepEqual({ ...back }, { ...error }, error.message);
  }
});

test("a conflict and an unreadable file carry typed details, and the deprecated fields too", () => {
  const conflict = crossed(new PageConflictError("Brief", revision, null)).wire;
  assert.equal(conflict.detail.case, "conflict");
  assert.equal(conflict.detail.case === "conflict" ? conflict.detail.value.expected : null, revision);
  assert.equal(conflict.detail.case === "conflict" ? conflict.detail.value.actual : "set", undefined);
  // A tab loaded before the detail reads these.
  assert.equal(conflict.expected, revision);
  assert.equal(conflict.actual, undefined);

  const unreadable = crossed(new FileUnreadableError("Cafe", "not-utf8")).wire;
  assert.equal(unreadable.detail.case, "unreadable");
  assert.equal(
    unreadable.detail.case === "unreadable" ? unreadable.detail.value.reason : null,
    UnreadableReason.NOT_UTF8,
  );
  assert.equal(unreadable.reason, "not-utf8");
});

test("a failure missing its detail, or with an unknown code, is a bad answer", () => {
  const bad = (e: PageStoreError) => isStoreError(e, "unavailable") && e.reason === "bad-answer";
  assert.ok(bad(errorFrom(create(StoreFailureSchema, { code: StoreErrorCode.CONFLICT, page: "Brief" }))));
  assert.ok(bad(errorFrom(create(StoreFailureSchema, { code: StoreErrorCode.UNREADABLE, page: "Cafe" }))));
  assert.ok(bad(errorFrom(create(StoreFailureSchema, { code: StoreErrorCode.UNSPECIFIED }))));
});

test("a library is shown only from a server that speaks this protocol", () => {
  const id = "AbCdEfGhIjKlMnOpQrSt_-";
  const info = (protocol: number, libraryId = id) => create(LibraryInfoSchema, { id: libraryId, protocol });
  assert.equal(libraryFrom(info(STORE_PROTOCOL), "127.0.0.1:4320"), id);
  const reason = (r: string) => (e: unknown) => isStoreError(e, "unavailable") && e.reason === r;
  assert.throws(() => libraryFrom(info(STORE_PROTOCOL - 1), "127.0.0.1:4320"), reason("older-server"));
  assert.throws(() => libraryFrom(info(STORE_PROTOCOL + 1), "127.0.0.1:4320"), reason("newer-server"));
  assert.throws(() => libraryFrom(info(STORE_PROTOCOL, "short"), "127.0.0.1:4320"), reason("bad-answer"));
  assert.throws(() => libraryFrom(undefined, "127.0.0.1:4320"), reason("bad-answer"));
});

test("methods go by their wire names, and only this protocol's", () => {
  assert.equal(wireName("readPage"), "ReadPage");
  assert.equal(wireName("getLibrary"), "GetLibrary");
  assert.equal(methodByWireName("ReadPage"), "readPage");
  assert.equal(methodByWireName("readPage"), null);
  assert.equal(methodByWireName("DeleteEverything"), null);
});

/** The server's guarantee, checked by `pnpm typecheck`: a table that leaves a method out isn't a full one. */
export function handlersWithout(partial: Omit<StoreHandlers, "getLibrary">): StoreHandlers {
  // @ts-expect-error A table without GetLibrary isn't a full set of handlers, so it doesn't compile.
  const full: StoreHandlers = partial;
  return full;
}
