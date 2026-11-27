/**
 * Ed25519 signing keys in Node, for the publisher commands (`a4 plugin
 * keygen` and `pack`), the example build, and the test packages. Keys are
 * PKCS #8 PEM text; a package carries the raw 32-byte public key. Node only:
 * the app verifies signatures, and never signs (see package.ts).
 */

import { createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject, sign } from "node:crypto";

/** An Ed25519 key that can sign, with its raw 32-byte public key. */
export interface SigningKey {
  readonly publicKey: Uint8Array;
  sign(bytes: Uint8Array): Uint8Array;
}

/** Why text isn't a usable signing key. */
export class KeyFormatError extends Error {
  override readonly name = "KeyFormatError";
  readonly problem: "not-a-key" | "not-ed25519";
  constructor(problem: "not-a-key" | "not-ed25519") {
    super(problem === "not-a-key" ? "It isn’t a private key." : "It isn’t an Ed25519 key.");
    this.problem = problem;
  }
}

function signingKeyOf(privateKey: KeyObject): SigningKey {
  if (privateKey.asymmetricKeyType !== "ed25519") throw new KeyFormatError("not-ed25519");
  const x = createPublicKey(privateKey).export({ format: "jwk" }).x;
  if (!x) throw new KeyFormatError("not-ed25519");
  return {
    publicKey: new Uint8Array(Buffer.from(x, "base64url")),
    sign: (bytes) => new Uint8Array(sign(null, bytes, privateKey)),
  };
}

/** A new key, and its private key as PKCS #8 PEM text to write to a file. */
export function newSigningKey(): { key: SigningKey; pem: string } {
  const { privateKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  return { key: signingKeyOf(privateKey), pem };
}

/** The key in `pem`; throws KeyFormatError when it isn't a private key, or isn't Ed25519. */
export function signingKeyFromPem(pem: string): SigningKey {
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey(pem);
  } catch {
    throw new KeyFormatError("not-a-key");
  }
  return signingKeyOf(privateKey);
}
