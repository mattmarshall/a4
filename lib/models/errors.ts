/**
 * Errors from the model host and plugins. Plugins throw ModelError with a
 * code; the worker transport carries the code across as an RpcError.
 */

export type ModelErrorCode =
  /** The plugin's card doesn't declare the operation. */
  | "unsupported-operation"
  /** The plugin doesn't implement a method it was asked for. */
  | "unimplemented"
  /** A result broke the contract (wrong plane shape, no candidate, ...). */
  | "invalid-result"
  /** A plugin that sends text off the device was called without fresh consent. */
  | "consent-required"
  /** The author canceled. */
  | "cancelled"
  /** The remote service rejected the credentials. */
  | "auth"
  /** The network or remote service failed. */
  | "network"
  /** The model declined the request. */
  | "refused"
  /** The model files aren't downloaded yet. */
  | "not-ready"
  /** Anything else the plugin reports. */
  | "plugin";

export class ModelError extends Error {
  readonly code: ModelErrorCode;
  constructor(code: ModelErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ModelError";
    this.code = code;
  }
}

const CODES = new Set<string>([
  "unsupported-operation",
  "unimplemented",
  "invalid-result",
  "consent-required",
  "cancelled",
  "auth",
  "network",
  "refused",
  "not-ready",
  "plugin",
]);

export function isModelErrorCode(value: string): value is ModelErrorCode {
  return CODES.has(value);
}

/** Wrap anything thrown into a ModelError, keeping an existing one. */
export function toModelError(error: unknown): ModelError {
  if (error instanceof ModelError) return error;
  if (error instanceof DOMException && error.name === "AbortError") return new ModelError("cancelled", "Canceled.", { cause: error });
  return new ModelError("plugin", error instanceof Error ? error.message : String(error), { cause: error });
}
