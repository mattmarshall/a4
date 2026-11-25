/**
 * Publishers A4 knows: a name and an Ed25519 public key each. A package
 * signed by a listed key shows that name with a Known publisher badge; any
 * other shows "Unknown publisher" with the name it gives itself. The list is
 * code, so a publisher is added only by a reviewed change to A4, never by a
 * download. It ships empty.
 */

export interface KnownPublisher {
  readonly name: string;
  /** The raw 32-byte public key, base64. */
  readonly publicKey: string;
}

export const KNOWN_PUBLISHERS: readonly KnownPublisher[] = [];

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** The listed publisher that holds `publicKey`, or null. The name a package gives itself is never consulted. */
export function knownPublisher(
  publicKey: Uint8Array,
  list: readonly KnownPublisher[] = KNOWN_PUBLISHERS,
): KnownPublisher | null {
  const key = base64(publicKey);
  return list.find((p) => p.publicKey === key) ?? null;
}
