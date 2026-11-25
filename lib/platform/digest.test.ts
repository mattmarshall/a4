import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256, verifyEd25519 } from "./digest.ts";

const hex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => Number.parseInt(h, 16));

// RFC 8032, section 7.1, TEST 1: the empty message.
const PUBLIC_KEY = hex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
const SIGNATURE = hex(
  "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
);

test("SHA-256 of the empty input", async () => {
  const digest = await sha256(new Uint8Array());
  assert.equal(Buffer.from(digest).toString("hex"), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("Ed25519: RFC 8032 test vector 1 verifies", async () => {
  assert.equal(await verifyEd25519(PUBLIC_KEY, SIGNATURE, new Uint8Array()), true);
});

test("Ed25519: one flipped bit in the signature fails", async () => {
  const flipped = SIGNATURE.slice();
  flipped[10] = (flipped[10] ?? 0) ^ 0x01;
  assert.equal(await verifyEd25519(PUBLIC_KEY, flipped, new Uint8Array()), false);
});

test("Ed25519: another message fails", async () => {
  assert.equal(await verifyEd25519(PUBLIC_KEY, SIGNATURE, new Uint8Array([0x72])), false);
});

test("Ed25519: keys and signatures of the wrong length are false, not errors", async () => {
  assert.equal(await verifyEd25519(PUBLIC_KEY.slice(0, 31), SIGNATURE, new Uint8Array()), false);
  assert.equal(await verifyEd25519(PUBLIC_KEY, SIGNATURE.slice(0, 63), new Uint8Array()), false);
});
