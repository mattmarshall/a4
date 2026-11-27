import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { KeyFormatError, newSigningKey, signingKeyFromPem } from "./signing-key-node.ts";

/** A Node public key object from a raw 32-byte Ed25519 public key. */
const nodePublicKey = (raw: Uint8Array) =>
  createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(raw).toString("base64url") }, format: "jwk" });

test("a new key's PEM reads back to the same raw 32-byte public key", () => {
  const { key, pem } = newSigningKey();
  assert.equal(key.publicKey.length, 32);
  assert.match(pem, /^-----BEGIN PRIVATE KEY-----/);
  assert.deepEqual(signingKeyFromPem(pem).publicKey, key.publicKey);
});

test("a signature verifies with node:crypto against the raw public key", () => {
  const { key } = newSigningKey();
  const message = new TextEncoder().encode("a manifest");
  const signature = key.sign(message);
  assert.equal(signature.length, 64);
  assert.equal(verify(null, message, nodePublicKey(key.publicKey), signature), true);
  assert.equal(verify(null, new TextEncoder().encode("another"), nodePublicKey(key.publicKey), signature), false);
});

test("an RSA key and text that isn't a key are refused, each with its problem", () => {
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "pem", type: "pkcs8" });
  assert.throws(
    () => signingKeyFromPem(rsa.toString()),
    (e: unknown) => e instanceof KeyFormatError && e.problem === "not-ed25519",
  );
  assert.throws(
    () => signingKeyFromPem("not a key"),
    (e: unknown) => e instanceof KeyFormatError && e.problem === "not-a-key",
  );
});
