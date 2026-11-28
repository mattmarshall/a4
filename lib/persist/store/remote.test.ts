import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryPageStore } from "./key-value.ts";
import { parsePageName } from "./names.ts";
import { RemotePageStore } from "./remote.ts";
import { folderFailure, handleStoreCall, STORE_PATH, storeHandlers } from "./serve.ts";
import { pageStoreContract } from "./testing/contract.ts";
import { libraryIdOf } from "./testing/library-id.ts";
import { isStoreError, type PageStore, type UnavailableReason } from "./types.ts";
import { STORE_PROTOCOL, type StoreHandlers } from "./wire.ts";

const LIBRARY = libraryIdOf("AbCdEfGhIjKlMnOpQrSt_-");

/** A fetch that answers store calls with `handlers`, in this process. */
function inProcess(handlers: StoreHandlers): typeof fetch {
  return async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (!path.startsWith(STORE_PATH)) return new Response(null, { status: 404 });
    const body = new Uint8Array(await new Response(init?.body ?? null).arrayBuffer());
    const result = await handleStoreCall(handlers, path.slice(STORE_PATH.length), body);
    return new Response(new Uint8Array(result.body), { status: result.status });
  };
}

const remoteWith = (answer: typeof fetch) =>
  new RemotePageStore({ base: "http://127.0.0.1:4320", token: "t", fetch: answer });
const remote = (store: PageStore) => remoteWith(inProcess(storeHandlers(store, LIBRARY)));

pageStoreContract("remote store over the handler (a4 serve's protocol)", async () => remote(new MemoryPageStore()), {
  tabs: async () => {
    const shared = new MemoryPageStore();
    return [remote(shared), remote(shared)] as const;
  },
});

const because = (reason: UnavailableReason) => (e: unknown) => isStoreError(e, "unavailable") && e.reason === reason;

test("the library is the server's id, when it speaks this protocol", async () => {
  assert.equal(await remote(new MemoryPageStore()).library(), LIBRARY);
  const speaking = (protocol: number) =>
    remoteWith(
      inProcess({
        ...storeHandlers(new MemoryPageStore(), LIBRARY),
        getLibrary: async () => ({ library: { id: LIBRARY, protocol } }),
      }),
    );
  await assert.rejects(speaking(STORE_PROTOCOL - 1).library(), because("older-server"));
  await assert.rejects(speaking(STORE_PROTOCOL + 1).library(), because("newer-server"));
  const malformed = remoteWith(
    inProcess({
      ...storeHandlers(new MemoryPageStore(), LIBRARY),
      getLibrary: async () => ({ library: { id: "not an id", protocol: STORE_PROTOCOL } }),
    }),
  );
  await assert.rejects(malformed.library(), because("bad-answer"));
});

test("a server that doesn't know GetLibrary is an older one", async () => {
  // An a4 serve from before GetLibrary answers an unknown method with 404 and no body.
  const handlers = inProcess(storeHandlers(new MemoryPageStore(), LIBRARY));
  const older = remoteWith(async (input, init) =>
    String(input).endsWith("/GetLibrary") ? new Response(null, { status: 404 }) : handlers(input, init),
  );
  await assert.rejects(older.library(), because("older-server"));
  // A page that isn't there is still not found: its 404 carries a failure.
  await assert.rejects(older.read(parsePageName("Brief")), (e: unknown) => isStoreError(e, "not-found"));
});

test("each way a server can't be used says why", async () => {
  const down = remoteWith(async () => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(
    down.list(),
    (e: unknown) => because("not-running")(e) && /isn’t running at 127\.0\.0\.1:4320/.test(String(e)),
  );
  for (const status of [401, 403]) {
    await assert.rejects(
      remoteWith(async () => new Response(null, { status })).read(parsePageName("Brief")),
      because("refused"),
    );
  }
  await assert.rejects(
    remoteWith(async () => new Response(new Uint8Array([0xff, 0xff, 0xff]), { status: 200 })).list(),
    because("bad-answer"),
  );
  await assert.rejects(remoteWith(async () => new Response(null, { status: 500 })).list(), because("bad-answer"));
});

test("an unknown method is 404, and a request that doesn't decode is 400", async () => {
  const handlers = storeHandlers(new MemoryPageStore(), LIBRARY);
  assert.equal((await handleStoreCall(handlers, "DeleteEverything", new Uint8Array())).status, 404);
  assert.equal((await handleStoreCall(handlers, "readPage", new Uint8Array())).status, 404);
  assert.equal((await handleStoreCall(handlers, "ReadPage", new Uint8Array([0xff, 0xff, 0xff]))).status, 400);
});

test("an answer cut off mid-body is the server stopping, never an empty listing", async () => {
  const cutOff = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([0x0a]));
          controller.error(new Error("socket closed"));
        },
      }),
      { status: 200 },
    );
  await assert.rejects(remoteWith(cutOff).list(), because("not-running"));
  await assert.rejects(remoteWith(cutOff).listTrash(), because("not-running"));
});

test("a failure in the server's folder reaches A4 with its code, not as an answer A4 can't read", async () => {
  const answer = folderFailure("EACCES");
  assert.equal(answer.status, 503);
  const failing = remoteWith(async () => new Response(new Uint8Array(answer.body), { status: answer.status }));
  await assert.rejects(
    failing.list(),
    (e: unknown) =>
      isStoreError(e, "unavailable") && e.reason === null && e.message === "a4 serve couldn’t use its folder (EACCES).",
  );
});
