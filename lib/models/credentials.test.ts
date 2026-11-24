import { test } from "node:test";
import assert from "node:assert/strict";
import { create } from "@bufbuild/protobuf";
import { ModelCardSchema } from "../gen/a4/v1/model_pb.js";
import { CredentialStore } from "./credentials.ts";
import { pluginIdOf } from "./plugin-id.ts";

const id = pluginIdOf(create(ModelCardSchema, { id: "p" }));
const other = pluginIdOf(create(ModelCardSchema, { id: "q" }));

test("credentials are trimmed, kept per plugin and kind, and an empty value forgets", () => {
  const store = new CredentialStore();
  store.set(id, "api-key", "  sk-1  ");
  assert.equal(store.get(id, "api-key"), "sk-1");
  assert.equal(store.get(other, "api-key"), null);
  assert.equal(store.get(id, "token"), null);
  store.set(id, "api-key", "   ");
  assert.equal(store.has(id, "api-key"), false);
  store.set(id, "api-key", "sk-2");
  store.forget(id, "api-key");
  assert.equal(store.get(id, "api-key"), null);
});
