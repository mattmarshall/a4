/**
 * A stand-in for the sandbox in Node tests: it serves kit handlers over a
 * MessageChannel instead of a frame and a worker, and records what each start
 * received (its options, and the runtime the plugin saw).
 */

import { type JsonValue, toJson } from "@bufbuild/protobuf";
import { type ModelCard, ModelCardSchema } from "../../gen/a4/v1/model_pb.js";
import type { PluginHandlers, PluginRuntime } from "../kit/serve.ts";
import { servePluginOnPort } from "../kit/testing/start.ts";
import type { SandboxOptions, SandboxPort } from "../sandbox.ts";

interface OpenedSandbox {
  readonly options: SandboxOptions;
  runtime: PluginRuntime | null;
  closed: boolean;
  /** Fail the sandbox as a crashed worker would: the frame reports it, and the port ends. */
  crash(message: string): void;
}

/** A sandbox opener whose plugin describes itself with `card` and runs `handlers`. */
export function fakeSandbox(card: ModelCard, handlers: (runtime: PluginRuntime) => PluginHandlers = () => ({})) {
  const opened: OpenedSandbox[] = [];
  const open = async (options: SandboxOptions): Promise<SandboxPort> => {
    const failures: ((message: string) => void)[] = [];
    const record: OpenedSandbox = {
      options,
      runtime: null,
      closed: false,
      crash: (message) => {
        record.closed = true;
        close();
        for (const listener of failures) listener(message);
      },
    };
    opened.push(record);
    const { port, close } = servePluginOnPort(
      toJson(ModelCardSchema, card) as JsonValue,
      (runtime) => {
        record.runtime = runtime;
        return handlers(runtime);
      },
      options.start,
    );
    return {
      postMessage: (message, transfer) => port.postMessage(message, transfer ?? []),
      addEventListener: (type, listener) => port.addEventListener(type, listener),
      removeEventListener: (type, listener) => port.removeEventListener(type, listener),
      start: () => port.start(),
      onFailure: (listener) => {
        failures.push(listener);
      },
      close: () => {
        record.closed = true;
        close();
      },
    };
  };
  return { open, opened };
}
