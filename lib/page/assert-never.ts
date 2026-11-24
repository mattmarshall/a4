/**
 * Exhaustiveness check for switches over a closed union: a case added to the
 * union without a branch fails to compile here.
 */
export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
