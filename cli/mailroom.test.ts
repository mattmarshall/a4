import { test } from "node:test";
import assert from "node:assert/strict";
import { fromJson, type JsonValue } from "@bufbuild/protobuf";
import { ANALYSIS_TEXTS } from "../lib/analysis/testing/texts.ts";
import { latestDelivery, LetterState, readLetters, sealLetter } from "../lib/desk/index.ts";
import { PaperSize } from "../lib/gen/a4/v1/sheet_pb.js";
import { FiledLetterSchema, LetterDeliverySchema, PageCheckSchema } from "../lib/desk/mailroom.ts";
import type { FolderFs } from "../lib/persist/index.ts";
import { nodeFixture } from "../lib/persist/folder/testing/fixtures.ts";
import { createMailroom, type Mailroom } from "./mailroom.ts";

const NOW = Date.UTC(2026, 10, 25, 9, 30, 12);
const DIR = ".agents/letters";
const fits = ANALYSIS_TEXTS.light;
const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => `Step ${i + 1}: check item ${i * 7 + 3} before moving on.`).join("\n");

/** A mailroom over a temporary folder holding `files`. */
async function withMailroom(
  files: Record<string, string>,
  run: (mailroom: Mailroom, fs: FolderFs, text: (path: string) => Promise<string | null>) => Promise<void>,
): Promise<void> {
  const fixture = await nodeFixture();
  try {
    const folder = await fixture.folder("repo", files);
    const fs = fixture.source.open(folder.handle);
    await run(createMailroom({ fs, now: () => NOW }), fs, (path) => folder.text(path));
  } finally {
    await fixture.dispose();
  }
}

interface Reply {
  readonly id?: unknown;
  readonly result?: Record<string, unknown>;
  readonly error?: { code: number; message: string };
}

/** Send one line, and parse the one reply (or none). */
async function send(mailroom: Mailroom, line: string): Promise<Reply | null> {
  const out = await mailroom.handle(line);
  assert.ok(out.length <= 1, "at most one reply per line");
  const first = out[0];
  return first === undefined ? null : JSON.parse(first);
}

let nextId = 1;
async function call(mailroom: Mailroom, method: string, params?: unknown): Promise<Reply> {
  const reply = await send(mailroom, JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }));
  assert.ok(reply);
  return reply;
}

interface ToolResult {
  readonly content: { type: string; text: string }[];
  readonly structuredContent?: JsonValue;
  readonly isError?: boolean;
}

async function tool(mailroom: Mailroom, name: string, args: unknown): Promise<ToolResult> {
  const reply = await call(mailroom, "tools/call", { name, arguments: args });
  assert.equal(reply.error, undefined, JSON.stringify(reply.error));
  const result = reply.result;
  assert.ok(result && Array.isArray(result.content));
  return {
    content: result.content,
    structuredContent: result.structuredContent as JsonValue,
    ...(result.isError === true ? { isError: true } : {}),
  };
}

const allText = (result: ToolResult) => result.content.map((c) => c.text).join("\n");

test("initialize: echoes a supported version, offers tools and prompts, and says how letters work", async () => {
  await withMailroom({}, async (mailroom) => {
    const { result } = await call(mailroom, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    assert.equal(result?.protocolVersion, "2025-06-18");
    assert.deepEqual(result?.capabilities, { tools: { listChanged: false }, prompts: { listChanged: false } });
    assert.deepEqual(result?.serverInfo, { name: "a4-mailroom", title: "A4 mailroom", version: "0.1.0" });
    const instructions = String(result?.instructions);
    assert.match(instructions, /write_letter/);
    assert.match(instructions, /lint_page/);
    assert.match(instructions, /A person reads and seals each letter/);
  });
});

test("initialize: an unsupported version gets 2025-11-25", async () => {
  await withMailroom({}, async (mailroom) => {
    const { result } = await call(mailroom, "initialize", { protocolVersion: "2024-11-05" });
    assert.equal(result?.protocolVersion, "2025-11-25");
  });
});

test("ping answers empty, and notifications and responses get no reply", async () => {
  await withMailroom({}, async (mailroom) => {
    assert.deepEqual((await call(mailroom, "ping")).result, {});
    assert.equal(await send(mailroom, '{"jsonrpc":"2.0","method":"notifications/initialized"}'), null);
    assert.equal(await send(mailroom, '{"jsonrpc":"2.0","method":"notifications/cancelled","params":{}}'), null);
    assert.equal(await send(mailroom, '{"jsonrpc":"2.0","id":7,"result":{}}'), null);
    assert.equal(await send(mailroom, "   "), null);
  });
});

test("protocol errors: bad JSON, a batch, an unknown method, and serving on", async () => {
  await withMailroom({}, async (mailroom) => {
    assert.equal((await send(mailroom, "{not json"))?.error?.code, -32700);
    assert.equal((await send(mailroom, '[{"jsonrpc":"2.0","id":1,"method":"ping"}]'))?.error?.code, -32600);
    assert.equal((await send(mailroom, '{"jsonrpc":"2.0","id":{},"method":"ping"}'))?.error?.code, -32600);
    assert.equal((await call(mailroom, "resources/list")).error?.code, -32601);
    assert.deepEqual((await call(mailroom, "ping")).result, {}, "still serving");
  });
});

test("tools/list: three tools with honest annotations, and none seals", async () => {
  await withMailroom({}, async (mailroom) => {
    const { result } = await call(mailroom, "tools/list");
    const tools = result?.tools as {
      name: string;
      title: string;
      inputSchema: { additionalProperties: boolean };
      annotations: Record<string, boolean>;
    }[];
    assert.deepEqual(
      tools.map((t) => t.name),
      ["lint_page", "write_letter", "read_letter"],
    );
    const byName = new Map(tools.map((t) => [t.name, t]));
    assert.deepEqual(byName.get("lint_page")?.annotations, { readOnlyHint: true, openWorldHint: false });
    assert.deepEqual(byName.get("read_letter")?.annotations, { readOnlyHint: true, openWorldHint: false });
    assert.deepEqual(byName.get("write_letter")?.annotations, {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
    for (const t of tools) {
      assert.ok(t.title, t.name);
      assert.equal(t.inputSchema.additionalProperties, false, t.name);
      assert.ok(!t.name.includes("seal"), t.name);
    }
  });
});

test("tools/call: an unknown tool is a protocol error, and bad arguments are the tool's error", async () => {
  await withMailroom({}, async (mailroom) => {
    assert.equal((await call(mailroom, "tools/call", { name: "seal_letter", arguments: {} })).error?.code, -32602);
    assert.ok((await call(mailroom, "tools/list")).result, "tools/list still answered");
    const wrongType = await tool(mailroom, "lint_page", { text: 5 });
    assert.equal(wrongType.isError, true);
    assert.match(allText(wrongType), /must be a string/);
    assert.equal((await tool(mailroom, "lint_page", {})).isError, true, "text is required");
    assert.equal((await tool(mailroom, "write_letter", { text: fits, path: "x.md" })).isError, true, "no paths");
  });
});

test("lint_page: rows, rows over, outcome, and findings, with a PageCheck and no text", async () => {
  await withMailroom({}, async (mailroom, fs) => {
    const result = await tool(mailroom, "lint_page", { text: rows(74) });
    assert.equal(result.isError, undefined);
    assert.match(allText(result), /^74 of 60 rows, 14 over: fails, Overflowing\./);
    assert.match(allText(result), /14 rows over the page/);
    assert.ok(result.structuredContent);
    const check = fromJson(PageCheckSchema, result.structuredContent);
    assert.equal(check.overBy, 14);
    assert.match(check.note, /^74 of 60 rows, 14 over: fails, Overflowing\./, "the note says it in words");
    const secret = await tool(mailroom, "lint_page", { text: `${fits}\ntoken: sk-test-123\n` });
    assert.match(allText(secret), /passes/);
    assert.ok(!JSON.stringify(secret.structuredContent).includes("sk-test-123"));
    assert.equal((await tool(mailroom, "lint_page", { text: "\n\n" })).isError, true);
    const entries: string[] = [];
    for await (const entry of fs.entries("")) entries.push(entry.name);
    assert.deepEqual(entries, [], "nothing written");
  });
});

test("write_letter: files a draft, says a person must seal it, and returns a FiledLetter", async () => {
  await withMailroom({}, async (mailroom, _fs, text) => {
    const result = await tool(mailroom, "write_letter", { text: rows(40), topic: "auth-migration" });
    assert.equal(result.isError, undefined);
    const path = `${DIR}/2026-11-25-0930-auth-migration.md`;
    assert.equal(await text(path), rows(40));
    assert.match(allText(result), /Filed draft \.agents\/letters\/2026-11-25-0930-auth-migration\.md/);
    assert.match(allText(result), /a person reads and seals it in A4 before it is delivered/);
    assert.ok(result.structuredContent);
    const filed = fromJson(FiledLetterSchema, result.structuredContent);
    assert.equal(filed.filed, true);
    assert.equal(filed.path, path);
    assert.match(filed.digest, /^urn:a4:letter:sha256:[0-9a-f]{64}$/);
    assert.match(filed.note, /^Filed draft \.agents\/letters\/2026-11-25-0930-auth-migration\.md/);
    assert.match(filed.note, /a person reads and seals it in A4 before it is delivered/);
    assert.equal(filed.check?.note, "", "the nested check doesn't repeat the note");
    assert.ok(!JSON.stringify(result.structuredContent).includes("Step 1: check item"));
  });
});

test("write_letter: a letter over the page is an error that says how far over, and nothing is written", async () => {
  await withMailroom({}, async (mailroom, fs) => {
    const result = await tool(mailroom, "write_letter", { text: rows(63) });
    assert.equal(result.isError, true);
    assert.match(allText(result), /Not filed: the letter is 3 rows over the page/);
    assert.ok(result.structuredContent);
    const refused = fromJson(FiledLetterSchema, result.structuredContent);
    assert.equal(refused.check?.overBy, 3);
    assert.match(refused.note, /^Not filed: the letter is 3 rows over the page/);
    assert.equal(await fs.stat(`${DIR}/2026-11-25-0930-letter.md`), null);
    const badTopic = await tool(mailroom, "write_letter", { text: fits, topic: "../notes" });
    assert.equal(badTopic.isError, true);
    assert.match(allText(badTopic), /isn't a topic/);
  });
});

test("read_letter: the accepted letter's exact text, then where it came from and what was returned", async () => {
  const A = `${DIR}/2026-11-24-1700-auth.md`;
  const B = `${DIR}/2026-11-25-0900-auth.md`;
  await withMailroom({ [A]: `${fits}\nA.\n`, [B]: `${fits}\nB.\n` }, async (mailroom, fs) => {
    await sealLetter(fs, A, { verdict: "accepted", signer: "Matt", now: NOW });
    await sealLetter(fs, B, { verdict: "returned", reason: "Missing the rollback plan", signer: "Ana", now: NOW });
    const result = await tool(mailroom, "read_letter", {});
    assert.equal(result.isError, undefined);
    assert.equal(result.content[0]?.text, `${fits}\nA.\n`);
    assert.match(result.content[1]?.text ?? "", /Accepted letter 2026-11-24-1700-auth\.md, sealed by Matt/);
    assert.match(result.content[1]?.text ?? "", /Returned since: 2026-11-25-0900-auth\.md: Missing the rollback plan/);
    assert.ok(result.structuredContent);
    const delivery = fromJson(LetterDeliverySchema, result.structuredContent);
    assert.equal(delivery.letter?.path, latestDelivery(await readLetters(fs))?.letter.letter.path);
    assert.equal(delivery.text, `${fits}\nA.\n`);
    assert.match(delivery.note, /sealed by Matt/);
    assert.match(delivery.note, /A seal means a person read and accepted the letter, not that it's true\./);
    assert.match(delivery.note, /Returned since: 2026-11-25-0900-auth\.md: Missing the rollback plan/);
    const firstLine = fits.split("\n")[0] ?? "";
    assert.ok(firstLine.length > 10 && !delivery.note.includes(firstLine), "the note never holds the letter's text");
  });
});

test("read_letter: with nothing to deliver, says so without any letter's text", async () => {
  const A = `${DIR}/2026-11-24-1700-auth.md`;
  const B = `${DIR}/2026-11-25-0900-auth.md`;
  await withMailroom({ [A]: "Draft letter text.\n", [B]: "Sealed text.\n" }, async (mailroom, fs) => {
    await sealLetter(fs, B, { verdict: "accepted", signer: "Matt", now: NOW });
    const letters = await readLetters(fs);
    // Break B's seal from outside, as another editor would.
    await fs.writeAtomic(B, new TextEncoder().encode("Edited after sealing.\n"));
    assert.equal((await readLetters(fs)).find((l) => l.letter.path === B)?.letter.state, LetterState.BROKEN);
    assert.equal(letters.length, 2);
    const result = await tool(mailroom, "read_letter", {});
    assert.equal(result.isError, undefined);
    assert.match(allText(result), /No letter to deliver/);
    assert.ok(result.structuredContent);
    assert.match(fromJson(LetterDeliverySchema, result.structuredContent).note, /^No letter to deliver/);
    const everything = JSON.stringify(result);
    for (const text of ["Draft letter text", "Sealed text", "Edited after sealing"]) {
      assert.ok(!everything.includes(text), text);
    }
  });
});

test("read_letter by digest: a filed draft is reported as a draft, without its text", async () => {
  await withMailroom({}, async (mailroom) => {
    const filed = await tool(mailroom, "write_letter", { text: `${fits}\nSecret draft line.\n` });
    assert.ok(filed.structuredContent);
    const { digest } = fromJson(FiledLetterSchema, filed.structuredContent);
    const result = await tool(mailroom, "read_letter", { digest });
    assert.equal(result.isError, undefined);
    assert.match(allText(result), /is a draft: a person hasn't sealed it/);
    assert.ok(!JSON.stringify(result).includes("Secret draft line"));
    const unknown = await tool(mailroom, "read_letter", { digest: `urn:a4:letter:sha256:${"0".repeat(64)}` });
    assert.match(allText(unknown), /has the digest/);
    assert.equal((await tool(mailroom, "read_letter", { digest: "sha256:00" })).isError, true);
  });
});

test("prompts: one letter prompt holding the Handoff form", async () => {
  await withMailroom({}, async (mailroom) => {
    const list = await call(mailroom, "prompts/list");
    const prompts = list.result?.prompts as { name: string }[];
    assert.deepEqual(
      prompts.map((p) => p.name),
      ["letter"],
    );
    const got = await call(mailroom, "prompts/get", { name: "letter", arguments: { topic: "auth" } });
    const messages = (got.result?.messages ?? []) as { role: string; content: { text: string } }[];
    const [message] = messages;
    assert.equal(message?.role, "user");
    const text = message?.content.text ?? "";
    assert.match(text, /HANDOFF · /);
    assert.match(text, /write_letter, with the topic "auth"/);
    assert.match(text, /lint_page/);
    assert.equal((await call(mailroom, "prompts/get", { name: "other" })).error?.code, -32602);
  });
});

test("sizes: a card is checked on 42 rows, filed as .a5.md, and a postcard over 29 rows isn't filed", async () => {
  await withMailroom({}, async (mailroom, fs, text) => {
    const checked = await tool(mailroom, "lint_page", { text: rows(45), size: "a5" });
    assert.match(allText(checked), /^45 of 42 rows, 3 over: fails/);
    assert.ok(checked.structuredContent);
    assert.equal(fromJson(PageCheckSchema, checked.structuredContent).paper, PaperSize.A5);

    const card = await tool(mailroom, "write_letter", { text: rows(30), topic: "auth", size: "a5" });
    assert.equal(card.isError, undefined);
    assert.equal(await text(`${DIR}/2026-11-25-0930-auth.a5.md`), rows(30));

    const short = Array.from({ length: 31 }, (_, i) => `Row ${i + 1}.`).join("\n");
    const postcard = await tool(mailroom, "write_letter", { text: short, topic: "deploy", size: "a6" });
    assert.equal(postcard.isError, true);
    assert.match(allText(postcard), /Not filed: the letter is 2 rows over the page/);
    assert.equal(await fs.stat(`${DIR}/2026-11-25-0930-deploy.a6.md`), null);

    const a3 = await tool(mailroom, "write_letter", { text: rows(10), topic: "big", size: "a3" });
    assert.equal(a3.isError, true);
    assert.match(allText(a3), /isn't a size/);
    assert.equal(await fs.stat(`${DIR}/2026-11-25-0930-big.md`), null);
  });
});

test("tools/list: lint_page and write_letter declare the sizes", async () => {
  await withMailroom({}, async (mailroom) => {
    const { result } = await call(mailroom, "tools/list");
    const tools = result?.tools as { name: string; inputSchema: { properties: Record<string, { enum?: string[] }> } }[];
    for (const name of ["lint_page", "write_letter"]) {
      assert.deepEqual(tools.find((t) => t.name === name)?.inputSchema.properties.size?.enum, ["a4", "a5", "a6"], name);
    }
  });
});
