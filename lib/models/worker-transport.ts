/**
 * The worker transport: a SheetModelClient over a MessagePort, with every
 * message an `a4.v1.RpcFrame` in protobuf bytes.
 *
 * A call is one request frame (id, method, payload). Its reply is one or more
 * frames with the same id; the last has `end` set, or carries an error. A
 * frame with method "$cancel" asks the server to abort a call.
 */

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { RpcFrameSchema, type RpcFrame } from "../gen/a4/v1/model_pb.js";
import { METHOD_NAMES, methodDesc, type MethodName, type SheetModelClient } from "./client.ts";
import { isModelErrorCode, ModelError, toModelError } from "./errors.ts";

/** The parts of MessagePort (browser or Node) the transport uses. */
export interface PortLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  start?: () => void;
  /** Called once if the other side can no longer answer (a worker crashed). */
  onFailure?: (listener: (message: string) => void) => void;
}

/** The events of a Worker that `fromWorker` uses. */
interface WorkerLike {
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  terminate(): void;
}

/**
 * A port over a dedicated worker that reports failures: a script that fails
 * to load, an uncaught error, or a message that can't be deserialized. The
 * worker is terminated on failure, so a fresh one can replace it.
 */
export function fromWorker(worker: WorkerLike): PortLike {
  return {
    postMessage: (message, transfer) => worker.postMessage(message, transfer ?? []),
    addEventListener: (type, listener) => worker.addEventListener(type, listener as (event: Event) => void),
    removeEventListener: (type, listener) => worker.removeEventListener(type, listener as (event: Event) => void),
    onFailure(listener) {
      let failed = false;
      const fail = (message: string) => {
        if (failed) return;
        failed = true;
        worker.terminate();
        listener(message);
      };
      worker.addEventListener("error", (event) => {
        event.preventDefault?.();
        const detail = (event as ErrorEvent).message;
        fail(detail ? `The model worker failed: ${detail}` : "The model worker failed to start or crashed.");
      });
      worker.addEventListener("messageerror", () => fail("The model worker sent a message that couldn't be read."));
    },
  };
}

const closedClients = new WeakSet<object>();

/** True once the client's worker failed; the host then connects a new one. */
export function isClosed(client: SheetModelClient): boolean {
  return closedClients.has(client);
}

const CANCEL = "$cancel";

function send(port: PortLike, frame: Parameters<typeof create<typeof RpcFrameSchema>>[1]): void {
  const bytes = toBinary(RpcFrameSchema, create(RpcFrameSchema, frame));
  // Copy into a standalone buffer so it can be transferred, not cloned.
  const buffer = bytes.slice().buffer;
  port.postMessage(buffer, [buffer]);
}

function frameOf(event: MessageEvent): RpcFrame | null {
  const data = event.data;
  if (!(data instanceof ArrayBuffer)) return null;
  try {
    return fromBinary(RpcFrameSchema, new Uint8Array(data));
  } catch {
    return null;
  }
}

/** A reply stream for one call: frames are queued until the caller reads them. */
class Reply {
  readonly #unary: boolean;
  readonly #items: Uint8Array[] = [];
  #done = false;
  #error: ModelError | null = null;
  #wake: (() => void) | null = null;

  constructor(unary: boolean) {
    this.#unary = unary;
  }

  push(frame: RpcFrame): void {
    if (frame.error) {
      const code = isModelErrorCode(frame.error.code) ? frame.error.code : "plugin";
      this.#error = new ModelError(code, frame.error.message);
      this.#done = true;
    } else if (this.#unary) {
      // A unary reply is a single end frame whose payload is the result, even
      // when empty: proto3 encodes an all-default message as zero bytes.
      if (frame.end) {
        this.#items.push(frame.payload);
        this.#done = true;
      }
    } else if (frame.end) {
      this.#done = true; // a stream ends with a bare frame
    } else {
      this.#items.push(frame.payload);
    }
    this.#wake?.();
  }

  fail(error: ModelError): void {
    this.#error = error;
    this.#done = true;
    this.#wake?.();
  }

  async *drain(): AsyncGenerator<Uint8Array> {
    for (;;) {
      if (this.#items.length) {
        yield this.#items.shift()!;
        continue;
      }
      if (this.#error) throw this.#error;
      if (this.#done) return;
      await new Promise<void>((resolve) => (this.#wake = resolve));
      this.#wake = null;
    }
  }
}

/** A client whose calls go over `port` to a `servePort` on the other side. */
export function connectPort(port: PortLike): SheetModelClient {
  let nextId = 1;
  const pending = new Map<number, Reply>();
  let failure: ModelError | null = null;
  const client: Record<string, unknown> = {};
  port.onFailure?.((message) => {
    failure = new ModelError("unavailable", message);
    closedClients.add(client);
    for (const reply of pending.values()) reply.fail(failure);
    pending.clear();
  });
  port.addEventListener("message", (event) => {
    const frame = frameOf(event);
    if (!frame) return;
    const reply = pending.get(frame.id);
    if (!reply) return;
    reply.push(frame);
    if (frame.end || frame.error) pending.delete(frame.id);
  });
  port.start?.();

  async function* call(name: MethodName, request: unknown, signal?: AbortSignal): AsyncGenerator<unknown> {
    const desc = methodDesc(name);
    if (signal?.aborted) throw new ModelError("cancelled", "Canceled.");
    if (failure) throw failure;
    const id = nextId++;
    const reply = new Reply(desc.methodKind === "unary");
    pending.set(id, reply);
    const onAbort = () => {
      send(port, { id, method: CANCEL, end: true });
      pending.delete(id);
      reply.fail(new ModelError("cancelled", "Canceled."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      send(port, { id, method: name, payload: toBinary(desc.input, create(desc.input, request as never)) });
      for await (const bytes of reply.drain()) yield fromBinary(desc.output, bytes);
    } finally {
      signal?.removeEventListener("abort", onAbort);
      pending.delete(id);
    }
  }

  for (const name of METHOD_NAMES) {
    if (methodDesc(name).methodKind === "unary") {
      client[name] = async (request: unknown, signal?: AbortSignal) => {
        let result: unknown;
        for await (const message of call(name, request, signal)) result = message;
        if (result === undefined) throw new ModelError("invalid-result", `${name} returned nothing`);
        return result;
      };
    } else {
      client[name] = (request: unknown, signal?: AbortSignal) => call(name, request, signal);
    }
  }
  return client as SheetModelClient;
}

/** Serve `client` (usually from `implement`) to callers on the other end of `port`. */
export function servePort(port: PortLike, client: SheetModelClient): () => void {
  const running = new Map<number, AbortController>();
  const listener = (event: MessageEvent) => {
    const frame = frameOf(event);
    if (!frame) return;
    if (frame.method === CANCEL) {
      running.get(frame.id)?.abort();
      return;
    }
    if (!(METHOD_NAMES as string[]).includes(frame.method)) {
      send(port, { id: frame.id, end: true, error: { code: "unimplemented", message: `No method ${frame.method}` } });
      return;
    }
    const name = frame.method as MethodName;
    const desc = methodDesc(name);
    const controller = new AbortController();
    running.set(frame.id, controller);
    void (async () => {
      try {
        const request = fromBinary(desc.input, frame.payload);
        const method = client[name] as (req: unknown, signal: AbortSignal) => unknown;
        if (desc.methodKind === "unary") {
          const result = await (method(request, controller.signal) as Promise<never>);
          if (!controller.signal.aborted) send(port, { id: frame.id, payload: toBinary(desc.output, result), end: true });
        } else {
          for await (const item of method(request, controller.signal) as AsyncIterable<never>) {
            if (controller.signal.aborted) break;
            send(port, { id: frame.id, payload: toBinary(desc.output, item) });
          }
          if (!controller.signal.aborted) send(port, { id: frame.id, end: true });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          const e = toModelError(error);
          send(port, { id: frame.id, end: true, error: { code: e.code, message: e.message } });
        }
      } finally {
        running.delete(frame.id);
      }
    })();
  };
  port.addEventListener("message", listener);
  port.start?.();
  return () => {
    port.removeEventListener("message", listener);
    for (const controller of running.values()) controller.abort();
  };
}
