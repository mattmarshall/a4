/**
 * Start a kit plugin in Node the way the sandbox starts it in a worker: a
 * start message carrying a port, dispatched on a stand-in for the worker's
 * scope.
 */

import { create, type JsonValue, type MessageInitShape, toBinary } from "@bufbuild/protobuf";
import { PluginStartSchema } from "../../../gen/a4/v1/plugin_pb.js";
import type { SheetModelClient } from "../../client.ts";
import { connectPort } from "../../worker-transport.ts";
import { type PluginHandlers, type PluginRuntime, servePlugin, type StartScope } from "../serve.ts";

/** Serve a plugin from `start` bytes, and return the host's end of its port. */
export function servePluginOnPort(
  card: JsonValue,
  handlers: (runtime: PluginRuntime) => PluginHandlers,
  start: Uint8Array,
): { port: MessagePort; close: () => void } {
  // A worker's scope delivers MessageEvents; an EventTarget stands in, and this adapter types it.
  const target = new EventTarget();
  const scope: StartScope = {
    addEventListener: (type, listener) => target.addEventListener(type, listener as EventListener),
    removeEventListener: (type, listener) => target.removeEventListener(type, listener as EventListener),
  };
  servePlugin(card, handlers, scope);
  const channel = new MessageChannel();
  target.dispatchEvent(new MessageEvent("message", { data: start, ports: [channel.port2] }));
  return {
    port: channel.port1,
    close: () => {
      channel.port1.close();
      channel.port2.close();
    },
  };
}

/** Serve a plugin with a start message built from `start`, and return a client connected to it. */
export function startPlugin(
  card: JsonValue,
  handlers: (runtime: PluginRuntime) => PluginHandlers,
  start: MessageInitShape<typeof PluginStartSchema> = {},
): { client: SheetModelClient; close: () => void } {
  const { port, close } = servePluginOnPort(
    card,
    handlers,
    toBinary(PluginStartSchema, create(PluginStartSchema, start)),
  );
  return { client: connectPort(port), close };
}
