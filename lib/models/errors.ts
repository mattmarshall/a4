/**
 * Errors from the model host and plugins. Plugins throw ModelError with an
 * `ErrorCode` (the enum in proto/a4/v1/model.proto); the worker transport
 * carries the code across in an RpcError.
 */

import { ErrorCode } from "../gen/a4/v1/model_pb.js";

export { ErrorCode };

export class ModelError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ModelError";
    this.code = code;
  }
}

/** True when `error` is a ModelError, with `code` when one is given. */
export function isModelError(error: unknown, code?: ErrorCode): error is ModelError {
  return error instanceof ModelError && (code === undefined || error.code === code);
}

/**
 * Error codes by the names earlier versions used ("invalid-result",
 * "consent-required", ...). Both spellings of canceled are accepted for one
 * release; anything unknown is PLUGIN.
 */
const NAMED: Readonly<Record<string, ErrorCode>> = {
  "unsupported-operation": ErrorCode.UNSUPPORTED_OPERATION,
  unimplemented: ErrorCode.UNIMPLEMENTED,
  "invalid-result": ErrorCode.INVALID_RESULT,
  "consent-required": ErrorCode.CONSENT_REQUIRED,
  canceled: ErrorCode.CANCELED,
  cancelled: ErrorCode.CANCELED,
  auth: ErrorCode.AUTH,
  network: ErrorCode.NETWORK,
  refused: ErrorCode.REFUSED,
  "not-ready": ErrorCode.NOT_READY,
  unavailable: ErrorCode.UNAVAILABLE,
  plugin: ErrorCode.PLUGIN,
  "not-found": ErrorCode.NOT_FOUND,
  "invalid-card": ErrorCode.INVALID_CARD,
};

export function errorCodeFromName(name: string): ErrorCode {
  return Object.hasOwn(NAMED, name) ? (NAMED[name] ?? ErrorCode.PLUGIN) : ErrorCode.PLUGIN;
}

/** An error's `code` when it's a name, as code outside A4's own errors may set it. */
function namedCode(error: unknown): string | null {
  const code: unknown = typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;
  return typeof code === "string" ? code : null;
}

/** Wrap anything thrown into a ModelError, keeping an existing one. */
export function toModelError(error: unknown): ModelError {
  if (error instanceof ModelError) return error;
  if (error instanceof DOMException && error.name === "AbortError")
    return new ModelError(ErrorCode.CANCELED, "Canceled.", { cause: error });
  const message = error instanceof Error ? error.message : String(error);
  const named = namedCode(error);
  return new ModelError(named === null ? ErrorCode.PLUGIN : errorCodeFromName(named), message, { cause: error });
}
