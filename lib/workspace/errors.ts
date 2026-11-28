/**
 * One way to turn failures into messages for the author, and to run an
 * action whose failure should be reported rather than lost as an unhandled
 * rejection.
 */

import { ModelError } from "../models/errors.ts";
import { PageStoreError } from "../persist/store/types.ts";
import type { Result } from "./types.ts";

/** Why a command can't run before the workspace has started. */
export const NOT_READY = "Storage isn’t ready yet.";

function errorName(error: unknown): string | undefined {
  return typeof error === "object" && error !== null ? (error as { name?: string }).name : undefined;
}

/** A plain-English sentence for any error A4 can hit. */
export function describeError(error: unknown): string {
  if (error instanceof PageStoreError || error instanceof ModelError) return error.message;
  switch (errorName(error)) {
    case "QuotaExceededError":
      return "The browser is out of storage space for this site.";
    case "NotAllowedError":
      return "The browser didn’t allow access.";
    case "NotFoundError":
      return "It no longer exists.";
    case "AbortError":
      return "It was canceled.";
  }
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

export type Notify = (message: string, tone?: "info" | "warn") => void;

/**
 * Run `action`, reporting a failure as "Couldn’t <what>: <reason>". Resolves
 * to the result, or undefined after a failure; never rejects.
 */
export async function runReported<T>(action: () => Promise<T>, notify: Notify, what: string): Promise<T | undefined> {
  try {
    return await action();
  } catch (error) {
    notify(`Couldn’t ${what}: ${describeError(error)}`, "warn");
    return undefined;
  }
}

/**
 * Report a failed result as "Couldn’t <what>: <reason>". Resolves to the
 * value, or undefined after a failure.
 */
export async function reportResult<T>(
  result: Promise<Result<T>>,
  notify: Notify,
  what: string,
): Promise<T | undefined> {
  const settled = await result;
  if (settled.ok) return settled.value;
  notify(`Couldn’t ${what}: ${describeError(settled.error)}`, "warn");
  return undefined;
}
