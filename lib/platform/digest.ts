/**
 * SHA-256 and Ed25519 through Web Crypto, which browsers and Node 24 and later
 * share as `globalThis.crypto`, so code above the platform can hash and check
 * signatures without reaching for a runtime.
 */

/** The SHA-256 digest of `bytes`. */
export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
}

/**
 * Whether `signature` is an Ed25519 signature of `data` by `publicKey` (a raw
 * 32-byte key). A key or signature of the wrong length, or a key that isn't a
 * valid point, is false. A runtime without Ed25519 throws, so a missing
 * algorithm is never mistaken for a bad signature.
 */
export async function verifyEd25519(publicKey: Uint8Array, signature: Uint8Array, data: Uint8Array): Promise<boolean> {
  if (publicKey.length !== 32 || signature.length !== 64) return false;
  const { subtle } = globalThis.crypto;
  let key: CryptoKey;
  try {
    key = await subtle.importKey("raw", new Uint8Array(publicKey), { name: "Ed25519" }, false, ["verify"]);
  } catch (error) {
    if (error instanceof DOMException && error.name === "DataError") return false;
    throw error;
  }
  return subtle.verify({ name: "Ed25519" }, key, new Uint8Array(signature), new Uint8Array(data));
}
