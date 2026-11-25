import { test } from "node:test";
import assert from "node:assert/strict";
import { create } from "@bufbuild/protobuf";
import { LetterVerdict, PostmarkSchema } from "../gen/a4/v1/letter_pb.js";
import { letterDigest, readPostmark } from "../desk/letters.ts";
import { sealOf } from "./seal.ts";

const utf8 = (s: string) => new TextEncoder().encode(s);

async function sealed(bytes: Uint8Array) {
  return create(PostmarkSchema, {
    letter: "2026-11-25-0930-auth.md",
    digest: await letterDigest(bytes),
    verdict: LetterVerdict.ACCEPTED,
    signer: "Matt",
  });
}

test("an unchanged letter's seal is intact", async () => {
  const bytes = utf8("# Auth\nShip the token refresh.\n");
  const seal = await sealOf({ bytes, postmark: await sealed(bytes) });
  assert.equal(seal.kind, "intact");
});

test("one changed byte breaks the seal", async () => {
  const bytes = utf8("# Auth\nShip the token refresh.\n");
  const postmark = await sealed(bytes);
  const changed = bytes.slice();
  changed[2] = (changed[2] ?? 0) ^ 1;
  assert.equal((await sealOf({ bytes: changed, postmark })).kind, "changed");
});

test("a letter with a byte-order mark is checked over its exact bytes", async () => {
  const withBom = utf8("﻿# Auth\n");
  const postmark = await sealed(withBom);
  assert.equal((await sealOf({ bytes: withBom, postmark })).kind, "intact");
  assert.equal(
    (await sealOf({ bytes: utf8("# Auth\n"), postmark })).kind,
    "changed",
    "dropping the mark changes the bytes",
  );
});

test("a page with no postmark has no seal", async () => {
  assert.equal((await sealOf({ bytes: utf8("x"), postmark: null })).kind, "none");
});

test("readPostmark reads a sidecar for its letter, and refuses one for another", async () => {
  const json = new TextEncoder().encode(
    JSON.stringify({
      letter: "a.md",
      digest: `urn:a4:letter:sha256:${"0".repeat(64)}`,
      verdict: "LETTER_VERDICT_ACCEPTED",
      signer: "Matt",
    }),
  );
  assert.equal(readPostmark(json, "a.md")?.signer, "Matt");
  assert.equal(readPostmark(json, "b.md"), null);
});
