import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryPageStore } from "./key-value.ts";
import { parsePageName } from "./names.ts";
import { RemotePageStore } from "./remote.ts";
import { handleStoreCall, STORE_PATH } from "./serve.ts";
import { pageStoreContract } from "./testing/contract.ts";
import { isStoreError, type PageStore } from "./types.ts";

/** A fetch that answers store calls with the handler over `store`, in this process. */
function inProcess(store: PageStore): typeof fetch {
  return async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (!path.startsWith(STORE_PATH)) return new Response(null, { status: 404 });
    const body = new Uint8Array(await new Response(init?.body ?? null).arrayBuffer());
    const result = await handleStoreCall(store, path.slice(STORE_PATH.length), body);
    return new Response(new Uint8Array(result.body), { status: result.status });
  };
}

const remote = (store: PageStore) =>
  new RemotePageStore({ base: "http://127.0.0.1:4320", token: "t", fetch: inProcess(store) });

pageStoreContract("remote store over the handler (a4 serve's protocol)", async () => remote(new MemoryPageStore()), {
  tabs: async () => {
    const shared = new MemoryPageStore();
    return [remote(shared), remote(shared)] as const;
  },
});

test("a store the server can't reach is unavailable, and so is one that refuses", async () => {
  const down = new RemotePageStore({
    base: "http://127.0.0.1:4320",
    token: "t",
    fetch: async () => {
      throw new TypeError("fetch failed");
    },
  });
  await assert.rejects(
    down.list(),
    (e: unknown) =>
      isStoreError(e, "unavailable") && /isn’t running at 127\.0\.0\.1:4320/.test(String((e as Error).message)),
  );
  const refusing = new RemotePageStore({
    base: "http://127.0.0.1:4320",
    token: "wrong",
    fetch: async () => new Response(null, { status: 401 }),
  });
  await assert.rejects(refusing.read(parsePageName("Brief")), (e: unknown) => isStoreError(e, "unavailable"));
});

test("an unknown method is 404, and a request that doesn't decode is 400", async () => {
  const store = new MemoryPageStore();
  assert.equal((await handleStoreCall(store, "DeleteEverything", new Uint8Array())).status, 404);
  assert.equal((await handleStoreCall(store, "ReadPage", new Uint8Array([0xff, 0xff, 0xff]))).status, 400);
});
