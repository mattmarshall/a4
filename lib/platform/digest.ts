/**
 * SHA-256 through Web Crypto, which browsers and Node 24 and later share as
 * `globalThis.crypto`, so code above the platform can hash without reaching
 * for a runtime.
 */

/** The SHA-256 digest of `bytes`. */
export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
}
