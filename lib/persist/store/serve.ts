/**
 * The served library's request handler (README, "Served library"): one page
 * store operation per call, as `a4.v1.PageStoreService` (proto/a4/v1/store.proto)
 * describes it, answered over any PageStore. It takes a method name and the
 * request's protobuf bytes and returns a status and the response's bytes. A
 * store error comes back as an `a4.v1.StoreFailure` with its status, so
 * RemotePageStore throws the same typed error.
 *
 * It uses no Node or DOM API: `a4 serve` wraps it in node:http, and the
 * contract tests call it in-process.
 */

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  PageStoreService,
  StoreErrorCode,
  StoreFailureSchema,
  type StoredPageSummary,
  type StoredTrashEntry,
  type StoredWrite,
} from "../../gen/a4/v1/store_pb.js";
import { parsePageName } from "./names.ts";
import { parseRevision } from "./revision.ts";
import { parseTrashId } from "./trash-ids.ts";
import {
  PageNotFoundError,
  PageStoreError,
  type PageStore,
  type PageSummary,
  type PageStoreErrorCode,
  type TrashEntry,
  type TrashId,
  type WriteResult,
} from "./types.ts";

export interface StoreCallResult {
  readonly status: number;
  readonly body: Uint8Array;
}

/** Each store error's code on the wire and its HTTP status. */
const ERRORS: Readonly<Record<PageStoreErrorCode, { code: StoreErrorCode; status: number }>> = {
  "not-found": { code: StoreErrorCode.NOT_FOUND, status: 404 },
  exists: { code: StoreErrorCode.EXISTS, status: 409 },
  "invalid-name": { code: StoreErrorCode.INVALID_NAME, status: 422 },
  "invalid-text": { code: StoreErrorCode.INVALID_TEXT, status: 422 },
  conflict: { code: StoreErrorCode.CONFLICT, status: 409 },
  unavailable: { code: StoreErrorCode.UNAVAILABLE, status: 503 },
  unreadable: { code: StoreErrorCode.UNREADABLE, status: 422 },
};

function summary(p: PageSummary): Omit<StoredPageSummary, "$typeName" | "$unknown"> {
  return { name: p.name, size: BigInt(p.size), modifiedAt: p.modifiedAt };
}

function written(w: WriteResult): Omit<StoredWrite, "$typeName" | "$unknown"> {
  return { name: w.name, revision: w.revision, size: BigInt(w.size), modifiedAt: w.modifiedAt };
}

function trashed(t: TrashEntry): Omit<StoredTrashEntry, "$typeName" | "$unknown"> {
  return { id: t.id, name: t.name, size: BigInt(t.size), trashedAt: t.trashedAt };
}

/** A trash id from the wire; one that names no trashed page reads as not found. */
function trashId(value: string): TrashId {
  const parsed = parseTrashId(value);
  if (!parsed) throw new PageNotFoundError(value);
  return parsed.id;
}

/** A request that decodes but can't be one this server's client sent. */
class BadRequest extends Error {}

type Handler = (store: PageStore, request: never) => Promise<unknown>;

/** Each method: run it on the store, with a request already decoded. */
const HANDLERS: Readonly<Record<string, Handler>> = {
  ListPages: async (store: PageStore) => ({ pages: (await store.list()).map(summary) }),
  ReadPage: async (store: PageStore, r: { name: string }) => {
    const page = await store.read(parsePageName(r.name));
    return {
      page: {
        name: page.name,
        text: page.text,
        revision: page.revision,
        size: BigInt(page.size),
        modifiedAt: page.modifiedAt,
      },
    };
  },
  CreatePage: async (store: PageStore, r: { name: string; text: string }) => ({
    result: written(await store.create(parsePageName(r.name), r.text)),
  }),
  CreateUniquePage: async (store: PageStore, r: { desired: string; text: string }) => ({
    result: written(await store.createUnique(r.desired, r.text)),
  }),
  WritePage: async (store: PageStore, r: { name: string; text: string; expected?: string }) => {
    // Revisions come from this server's own answers, so one that doesn't parse is a malformed request.
    const expected = r.expected === undefined ? null : parseRevision(r.expected);
    if (r.expected !== undefined && expected === null) throw new BadRequest();
    return { result: written(await store.write(parsePageName(r.name), r.text, expected)) };
  },
  RenamePage: async (store: PageStore, r: { from: string; to: string }) => ({
    result: written(await store.rename(parsePageName(r.from), parsePageName(r.to))),
  }),
  TrashPage: async (store: PageStore, r: { name: string }) => ({
    entry: trashed(await store.trash(parsePageName(r.name))),
  }),
  ListTrash: async (store: PageStore) => ({ entries: (await store.listTrash()).map(trashed) }),
  RestorePage: async (store: PageStore, r: { id: string }) => ({
    result: written(await store.restore(trashId(r.id))),
  }),
  PurgePage: async (store: PageStore, r: { id: string }) => {
    await store.purge(trashId(r.id));
    return {};
  },
};

function failure(error: PageStoreError): StoreCallResult {
  const { code, status } = ERRORS[error.code];
  const detail = error as PageStoreError & {
    page?: string;
    input?: string;
    expected?: string;
    actual?: string | null;
    reason?: string;
  };
  const message = create(StoreFailureSchema, {
    code,
    message: error.message,
    page: detail.page ?? detail.input ?? "",
    expected: detail.expected ?? "",
    ...(typeof detail.actual === "string" ? { actual: detail.actual } : {}),
    reason: detail.reason ?? "",
  });
  return { status, body: toBinary(StoreFailureSchema, message) };
}

/** The path prefix of every store call. */
export const STORE_PATH = `/${PageStoreService.typeName}/`;

/**
 * Answer one call: `method` (such as "ReadPage") with the request's protobuf
 * bytes. Unknown methods are 404 and undecodable requests 400, with an empty
 * body; store errors are a StoreFailure with their status.
 */
export async function handleStoreCall(store: PageStore, method: string, body: Uint8Array): Promise<StoreCallResult> {
  const handler = HANDLERS[method];
  const desc = Object.values(PageStoreService.method).find((m) => m.name === method);
  if (!handler || !desc) return { status: 404, body: new Uint8Array() };
  let request: unknown;
  try {
    request = fromBinary(desc.input, body);
  } catch {
    return { status: 400, body: new Uint8Array() };
  }
  try {
    const response = await handler(store, request as never);
    return { status: 200, body: toBinary(desc.output, create(desc.output, response as never)) };
  } catch (error) {
    if (error instanceof PageStoreError) return failure(error);
    if (error instanceof BadRequest) return { status: 400, body: new Uint8Array() };
    throw error;
  }
}
