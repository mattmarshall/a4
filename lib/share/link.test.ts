import { randomBytes } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { create, toBinary } from "@bufbuild/protobuf";
import { SharedPagesSchema } from "../gen/a4/v1/share_pb.js";
import { PaperSize, type Preset } from "../gen/a4/v1/sheet_pb.js";
import { ANALYSIS_TEXTS } from "../analysis/testing/texts.ts";
import { LINK_LIMIT, readLink, ShareError, type ShareProblem, SHARE_ORIGIN, shareLink } from "./link.ts";

const utf8 = (s: string) => new TextEncoder().encode(s);

async function refused(input: string | Promise<unknown>, problem: ShareProblem, message?: RegExp) {
  await assert.rejects(typeof input === "string" ? readLink(input) : input, (e: unknown) => {
    assert.ok(e instanceof ShareError, String(e));
    assert.equal(e.problem, problem, e.message);
    if (message) assert.match(e.message, message);
    return true;
  });
}

/** A link built by hand from `message` bytes, compressed or not. */
async function rawLink(payload: Uint8Array, compress = true): Promise<string> {
  let bytes = payload;
  if (compress) {
    const stream = new Blob([new Uint8Array(payload)]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return `#s1.${Buffer.from(bytes).toString("base64url")}`;
}

test("a page survives the round trip: name, preset, paper, and exact bytes", async () => {
  const bytes = utf8("﻿Deploy on Fridays.\r\nNever on Mondays.\n");
  const link = await shareLink([{ name: "Deploy note.a5", preset: "pica", paper: "a5", bytes }], SHARE_ORIGIN);
  assert.match(link, /^https:\/\/a4\.marsh\.build\/#s1\.[A-Za-z0-9_-]+$/);
  const [page] = await readLink(link);
  assert.equal(page?.name, "Deploy note.a5");
  assert.equal(page?.spec.id, "pica");
  assert.equal(page?.spec.paper, "a5");
  assert.deepEqual(page?.bytes, bytes, "the bytes, byte-order mark included");
  assert.equal(page?.text, "Deploy on Fridays.\r\nNever on Mondays.\n", "the text, without the byte-order mark");
  assert.equal(page?.postmark, null);
});

test("a pair keeps its order, and the fragment alone reads too", async () => {
  const link = await shareLink(
    [
      { name: "Brief", preset: "terminal", paper: "a4", bytes: utf8("a") },
      { name: "Brief (fit)", preset: "terminal", paper: "a4", bytes: utf8("b") },
    ],
    "http://localhost:5173/",
  );
  assert.ok(link.startsWith("http://localhost:5173/#s1."));
  const pages = await readLink(link.slice(link.indexOf("#")));
  assert.deepEqual(
    pages.map((p) => p.name),
    ["Brief", "Brief (fit)"],
  );
});

test("a full page of prose makes a link under 4,000 characters", async () => {
  // Different texts, not one repeated, so the page compresses as a real one would.
  const page = Object.values(ANALYSIS_TEXTS).join("\n").slice(0, 4800);
  assert.equal(page.length, 4800);
  const link = await shareLink([{ name: "Page", preset: "terminal", paper: "a4", bytes: utf8(page) }], SHARE_ORIGIN);
  assert.ok(link.length < 4000, `${link.length} characters`);
});

test("a link over 16,384 characters is refused", async () => {
  // Random text doesn't compress: 40,000 characters of base64.
  const noise = randomBytes(30_000).toString("base64");
  await refused(
    shareLink([{ name: "Noise", preset: "terminal", paper: "a4", bytes: utf8(noise) }], SHARE_ORIGIN),
    "too-long",
    new RegExp(`too large for a link .* of ${LINK_LIMIT.toLocaleString("en-US")} characters\\)\\. Download it instead`),
  );
});

test("links it can't read are refused, each with its reason", async () => {
  await refused("https://a4.marsh.build/#s2.abc", "version", /newer A4/);
  await refused("#s1.not*base64", "malformed");
  await refused(await rawLink(utf8("not deflate at all"), false), "malformed");
  await refused(await rawLink(toBinary(SharedPagesSchema, create(SharedPagesSchema, {}))), "pages");
  const three = create(SharedPagesSchema, {
    pages: [1, 2, 3].map((i) => ({ name: `P${i}`, text: utf8(String(i)) })),
  });
  await refused(await rawLink(toBinary(SharedPagesSchema, three)), "pages");
  const latin1 = create(SharedPagesSchema, {
    pages: [{ name: "Bad", text: new Uint8Array([0x63, 0x61, 0x66, 0xe9]) }],
  });
  await refused(await rawLink(toBinary(SharedPagesSchema, latin1)), "not-utf8");
  await refused("https://a4.marsh.build/", "malformed");
});

test("a payload that decompresses to 2 MiB is refused at 1 MiB", async () => {
  const big = create(SharedPagesSchema, { pages: [{ name: "Big", text: new Uint8Array(2 * 1024 * 1024).fill(97) }] });
  const link = await rawLink(toBinary(SharedPagesSchema, big));
  assert.ok(link.length < LINK_LIMIT, "it compresses into a short link");
  await refused(link, "too-large", /more than 1 MiB/);
});

test("a page with an unknown preset opens on Terminal, on its paper", async () => {
  const msg = create(SharedPagesSchema, {
    pages: [{ name: "X", preset: 99 as Preset, paper: PaperSize.A5, text: utf8("x") }],
  });
  const [page] = await readLink(await rawLink(toBinary(SharedPagesSchema, msg)));
  assert.equal(page?.spec.id, "terminal");
  assert.equal(page?.spec.paper, "a5");
});
