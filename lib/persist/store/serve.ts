/**
 * The served library's request handler (README, "Served library"): one page
 * store operation per call, as `a4.v1.PageStoreService` (proto/a4/v1/store.proto)
 * describes it, answered over any PageStore, plus `GetLibrary` for the
 * library's id and protocol version.
 *
 * The handlers are a `StoreHandlers` table (wire.ts), so a method the proto
 * adds doesn't compile until it's handled here. A call takes a method's wire
 * name and the request's protobuf bytes, and returns a status and the
 * response's bytes. A store error comes back as an `a4.v1.StoreFailure` with
 * its status and typed detail, so RemotePageStore throws the same error.
 *
 * It uses no Node or DOM API: `a4 serve` wraps it in node:http, and the
 * contract tests call it in-process.
 */

import { create, toBinary } from "@bufbuild/protobuf";
import { StoreFailureSchema } from "../../gen/a4/v1/store_pb.js";
import { parsePageName } from "./names.ts";
import { parseRevision } from "./revision.ts";
import { parseTrashId } from "./trash-ids.ts";
import { PageNotFoundError, PageStoreError, type PageStore, type TrashId } from "./types.ts";
import {
  failureOf,
  type LibraryId,
  methodByWireName,
  decodeRequest,
  encodeResponse,
  pageWire,
  STORE_PROTOCOL,
  type StoreHandlers,
  type StoreMethod,
  type StoreRequest,
  summaryWire,
  trashWire,
  writeWire,
} from "./wire.ts";

export { STORE_PATH } from "./wire.ts";

export interface StoreCallResult {
  readonly status: number;
  readonly body: Uint8Array;
}

/** A trash id from the wire; one that names no trashed page reads as not found. */
function trashId(value: string): TrashId {
  const parsed = parseTrashId(value);
  if (!parsed) throw new PageNotFoundError(value);
  return parsed.id;
}

/** A request that decodes but can't be one this server's client sent. */
class BadRequest extends Error {}

/** Every method, answered over `store`, for the library `id`. */
export function storeHandlers(store: PageStore, id: LibraryId): StoreHandlers {
  return {
    listPages: async () => ({ pages: (await store.list()).map(summaryWire.to) }),
    readPage: async (r) => ({ page: pageWire.to(await store.read(parsePageName(r.name))) }),
    createPage: async (r) => ({ result: writeWire.to(await store.create(parsePageName(r.name), r.text)) }),
    createUniquePage: async (r) => ({ result: writeWire.to(await store.createUnique(r.desired, r.text)) }),
    writePage: async (r) => {
      // Revisions come from this server's own answers, so one that doesn't parse is a malformed request.
      const expected = r.expected === undefined ? null : parseRevision(r.expected);
      if (r.expected !== undefined && expected === null) throw new BadRequest();
      return { result: writeWire.to(await store.write(parsePageName(r.name), r.text, expected)) };
    },
    renamePage: async (r) => ({
      result: writeWire.to(await store.rename(parsePageName(r.from), parsePageName(r.to))),
    }),
    trashPage: async (r) => ({ entry: trashWire.to(await store.trash(parsePageName(r.name))) }),
    listTrash: async () => ({ entries: (await store.listTrash()).map(trashWire.to) }),
    restorePage: async (r) => ({ result: writeWire.to(await store.restore(trashId(r.id))) }),
    purgePage: async (r) => {
      await store.purge(trashId(r.id));
      return {};
    },
    getLibrary: async () => ({ library: { id, protocol: STORE_PROTOCOL } }),
  };
}

/** Decode `method`'s request, run its handler, and encode its response; 400 for a request that doesn't decode. */
async function answer<K extends StoreMethod>(
  handlers: StoreHandlers,
  method: K,
  body: Uint8Array,
): Promise<StoreCallResult> {
  let request: StoreRequest<K>;
  try {
    request = decodeRequest(method, body);
  } catch {
    return { status: 400, body: new Uint8Array() };
  }
  const handler: StoreHandlers[K] = handlers[method];
  return { status: 200, body: encodeResponse(method, await handler(request)) };
}

/**
 * Answer one call: the method's wire name (such as "ReadPage") with the
 * request's protobuf bytes. Unknown methods are 404 and undecodable requests
 * 400, with an empty body; store errors are a StoreFailure with their status.
 */
export async function handleStoreCall(
  handlers: StoreHandlers,
  wireName: string,
  body: Uint8Array,
): Promise<StoreCallResult> {
  const method = methodByWireName(wireName);
  if (!method) return { status: 404, body: new Uint8Array() };
  try {
    return await answer(handlers, method, body);
  } catch (error) {
    if (error instanceof PageStoreError) {
      const { status, failure } = failureOf(error);
      return { status, body: toBinary(StoreFailureSchema, create(StoreFailureSchema, failure)) };
    }
    if (error instanceof BadRequest) return { status: 400, body: new Uint8Array() };
    throw error;
  }
}
