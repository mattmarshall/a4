/**
 * The in-process shape of an `a4.v1.SheetModelService`, derived from the
 * generated service descriptor: unary methods return a promise, streaming
 * methods return an async iterable. Every transport (in-process, worker, and
 * later HTTP) exposes this same client.
 */

import { create, type DescMessage, type MessageInitShape, type MessageShape } from "@bufbuild/protobuf";
import type { GenService } from "@bufbuild/protobuf/codegenv2";
import { SheetModelService } from "../gen/a4/v1/model_pb.js";
import { ModelError } from "./errors.ts";

type Methods = typeof SheetModelService extends GenService<infer T> ? T : never;
export type MethodName = keyof Methods & string;

type In<K extends MethodName> = MessageShape<Methods[K]["input"]>;
type Out<K extends MethodName> = MessageShape<Methods[K]["output"]>;
type OutInit<K extends MethodName> = MessageInitShape<Methods[K]["output"]>;

export type SheetModelClient = {
  [K in MethodName]: Methods[K]["methodKind"] extends "unary"
    ? (request: In<K>, signal?: AbortSignal) => Promise<Out<K>>
    : (request: In<K>, signal?: AbortSignal) => AsyncIterable<Out<K>>;
};

/** What a plugin implements: results may be plain init objects. */
export type SheetModelHandlers = {
  [K in MethodName]: Methods[K]["methodKind"] extends "unary"
    ? (request: In<K>, signal?: AbortSignal) => Promise<OutInit<K>> | OutInit<K>
    : (request: In<K>, signal?: AbortSignal) => AsyncIterable<OutInit<K>>;
};

export const METHOD_NAMES = Object.keys(SheetModelService.method) as MethodName[];

export function methodDesc(name: MethodName) {
  return SheetModelService.method[name] as unknown as {
    methodKind: "unary" | "server_streaming";
    input: DescMessage;
    output: DescMessage;
  };
}

/**
 * Turn partial handlers into a full client: results are normalized into
 * messages, and missing methods fail with "unimplemented".
 */
export function implement(handlers: Partial<SheetModelHandlers>): SheetModelClient {
  const client: Record<string, unknown> = {};
  for (const name of METHOD_NAMES) {
    const desc = methodDesc(name);
    const handler = handlers[name] as ((req: unknown, signal?: AbortSignal) => unknown) | undefined;
    if (desc.methodKind === "unary") {
      client[name] = async (req: unknown, signal?: AbortSignal) => {
        if (!handler) throw new ModelError("unimplemented", `${name} is not implemented`);
        return create(desc.output, (await handler(req, signal)) as never);
      };
    } else {
      client[name] = async function* (req: unknown, signal?: AbortSignal) {
        if (!handler) throw new ModelError("unimplemented", `${name} is not implemented`);
        for await (const item of handler(req, signal) as AsyncIterable<unknown>) yield create(desc.output, item as never);
      };
    }
  }
  return client as SheetModelClient;
}
