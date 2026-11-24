/**
 * The worker transport: a SheetModelClient over a MessagePort, with every
 * message an `a4.v1.RpcFrame` (proto/a4/v1/rpc.proto) in protobuf bytes.
 *
 * A call is a `call` frame (id, method, payload). Its reply is zero or more
 * `message` frames and an `end`, or an `error`, all with the call's id. A
 * `cancel` frame asks the server to abort a call. A frame that can't be
 * decoded but has an id gets an error reply, so no call waits forever.
 */

import { create, fromBinary, toBinary, type MessageInitShape } from "@bufbuild/protobuf";
import { RpcFrameSchema, type RpcFrame } from "../gen/a4/v1/rpc_pb.js";
import { METHOD_NAMES, methodDesc, type MethodName, type SheetModelClient } from "./client.ts";
import { ErrorCode, ModelError, toModelError } from "./errors.ts";

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

function send(port: PortLike, frame: MessageInitShape<typeof RpcFrameSchema>): void {
  const bytes = toBinary(RpcFrameSchema, create(RpcFrameSchema, frame));
  // Copy into a standalone buffer so it can be transferred, not cloned.
  const buffer = bytes.slice().buffer;
  port.postMessage(buffer, [buffer]);
}

function sendError(port: PortLike, id: number, code: ErrorCode, message: string): void {
  send(port, { id, kind: { case: "error", value: { code, message } } });
}

/**
 * The id at the start of an encoded frame (field 1, a varint, which the
 * encoder writes first), so an undecodable frame can still be answered.
 */
function peekId(bytes: Uint8Array): number | null {
  if (bytes[0] !== 0x08) return null;
  let id = 0;
  for (let i = 1, shift = 0; i < bytes.length && shift < 35; i++, shift += 7) {
    const byte = bytes[i] ?? 0;
    id += (byte & 0x7f) * 2 ** shift;
    if (byte < 0x80) return id;
  }
  return null;
}

type Read = { readonly frame: RpcFrame } | { readonly unreadable: number | null };

/** Decode a message: a frame with a kind, or the id (if any) of one that couldn't be read. */
function readFrame(event: MessageEvent): Read {
  const data: unknown = event.data;
  if (!(data instanceof ArrayBuffer)) return { unreadable: null };
  const bytes = new Uint8Array(data);
  try {
    const frame = fromBinary(RpcFrameSchema, bytes);
    return frame.kind.case === undefined ? { unreadable: frame.id } : { frame };
  } catch {
    return { unreadable: peekId(bytes) };
  }
}

const UNREADABLE_MESSAGE = "A message between the page and the model worker couldn't be read.";

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

  /** Take a reply frame; true when it ends the call. */
  push(frame: RpcFrame): boolean {
    const { kind } = frame;
    switch (kind.case) {
      case "error":
        this.#error = new ModelError(kind.value.code || ErrorCode.PLUGIN, kind.value.message);
        this.#done = true;
        break;
      case "end":
        // A unary reply's result is the end frame's payload, even when empty:
        // proto3 encodes an all-default message as zero bytes.
        if (this.#unary) this.#items.push(kind.value.payload);
        this.#done = true;
        break;
      case "message":
        if (!this.#unary) this.#items.push(kind.value.payload);
        break;
      default:
        // A call or cancel frame isn't a reply: ignore it.
        return false;
    }
    this.#wake?.();
    return this.#done;
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
    failure = new ModelError(ErrorCode.UNAVAILABLE, message);
    closedClients.add(client);
    for (const reply of pending.values()) reply.fail(failure);
    pending.clear();
  });
  port.addEventListener("message", (event) => {
    const read = readFrame(event);
    if ("unreadable" in read) {
      // A reply that can't be read ends its call, rather than leaving it waiting.
      const reply = read.unreadable === null ? undefined : pending.get(read.unreadable);
      if (reply && read.unreadable !== null) {
        reply.fail(new ModelError(ErrorCode.UNREADABLE, UNREADABLE_MESSAGE));
        pending.delete(read.unreadable);
      }
      return;
    }
    const { frame } = read;
    const reply = pending.get(frame.id);
    if (reply?.push(frame)) pending.delete(frame.id);
  });
  port.start?.();

  async function* call(name: MethodName, request: unknown, signal?: AbortSignal): AsyncGenerator<unknown> {
    const desc = methodDesc(name);
    if (signal?.aborted) throw new ModelError(ErrorCode.CANCELED, "Canceled.");
    if (failure) throw failure;
    const id = nextId++;
    const reply = new Reply(desc.methodKind === "unary");
    pending.set(id, reply);
    const onAbort = () => {
      send(port, { id, kind: { case: "cancel", value: {} } });
      pending.delete(id);
      reply.fail(new ModelError(ErrorCode.CANCELED, "Canceled."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const payload = toBinary(desc.input, create(desc.input, request as never));
      send(port, { id, kind: { case: "call", value: { method: name, payload } } });
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
        if (result === undefined) throw new ModelError(ErrorCode.INVALID_RESULT, `${name} returned nothing`);
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
    const read = readFrame(event);
    if ("unreadable" in read) {
      if (read.unreadable !== null) sendError(port, read.unreadable, ErrorCode.UNREADABLE, UNREADABLE_MESSAGE);
      return;
    }
    const { id, kind } = read.frame;
    if (kind.case === "cancel") {
      running.get(id)?.abort();
      return;
    }
    if (kind.case !== "call") return; // replies aren't requests
    const name = METHOD_NAMES.find((m) => m === kind.value.method);
    if (!name) {
      sendError(port, id, ErrorCode.UNIMPLEMENTED, `No method ${kind.value.method}`);
      return;
    }
    const desc = methodDesc(name);
    const controller = new AbortController();
    running.set(id, controller);
    void (async () => {
      try {
        const request = fromBinary(desc.input, kind.value.payload);
        const method = client[name] as (req: unknown, signal: AbortSignal) => unknown;
        if (desc.methodKind === "unary") {
          const result = await (method(request, controller.signal) as Promise<never>);
          if (!controller.signal.aborted) {
            send(port, { id, kind: { case: "end", value: { payload: toBinary(desc.output, result) } } });
          }
        } else {
          for await (const item of method(request, controller.signal) as AsyncIterable<never>) {
            if (controller.signal.aborted) break;
            send(port, { id, kind: { case: "message", value: { payload: toBinary(desc.output, item) } } });
          }
          if (!controller.signal.aborted) send(port, { id, kind: { case: "end", value: {} } });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          const e = toModelError(error);
          sendError(port, id, e.code, e.message);
        }
      } finally {
        running.delete(id);
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
