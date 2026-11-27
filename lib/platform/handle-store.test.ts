import { test } from "node:test";
import { MemoryHandleStore } from "./handle-store.ts";
import { HANDLE_STORE_CONTRACT } from "./testing/handle-store-contract.ts";

const handles = { a: { name: "notes" }, b: { name: "agents" }, same: async (x: unknown, y: unknown) => x === y };

for (const [name, run] of HANDLE_STORE_CONTRACT) {
  test(`memory handle store: ${name}`, () => run(new MemoryHandleStore<{ name: string }>(), handles));
}
