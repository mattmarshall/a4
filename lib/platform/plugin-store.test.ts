import { test } from "node:test";
import { MemoryPluginStore } from "./plugin-store.ts";
import { PLUGIN_STORE_CONTRACT } from "./testing/plugin-store-contract.ts";

for (const [name, run] of PLUGIN_STORE_CONTRACT) {
  test(`memory plugin store: ${name}`, () => run(new MemoryPluginStore()));
}
