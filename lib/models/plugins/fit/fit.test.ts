import assert from "node:assert/strict";
import { test } from "node:test";
import { create } from "@bufbuild/protobuf";
import * as sdk from "@anthropic-ai/sdk";
import { Operation, TransformRequestSchema } from "../../../gen/a4/v1/model_pb.js";
import { PRESETS } from "../../../page/index.ts";
import { sheetRecord } from "../../../tensor/record.ts";
import { ErrorCode, ModelError } from "../../errors.ts";
import { ModelHost } from "../../host.ts";
import { fitToPagePlugin, mapError, type StreamingClient } from "./adapter.ts";
import { FIT_TO_PAGE, FIT_TO_PAGE_CARD, FIT_TO_PAGE_ID } from "./descriptor.ts";
import { stripWrappingFence } from "./prompt.ts";

const T = PRESETS.terminal;
const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");

interface Reply {
  text?: string;
  stop?: string;
  throws?: unknown;
}

/** A stub SDK client: records each request, streams `text`, then resolves the final message. */
function stub(replies: Reply[]) {
  const requests: { body: Record<string, unknown>; signal: AbortSignal | undefined }[] = [];
  const client: StreamingClient = {
    beta: {
      messages: {
        stream(body, options) {
          const reply = replies[requests.length] ?? replies[replies.length - 1];
          requests.push({ body: structuredClone(body) as unknown as Record<string, unknown>, signal: options?.signal });
          const text = reply.text ?? "";
          const content = [
            { type: "thinking", thinking: "", signature: `sig-${requests.length}` },
            { type: "text", text, citations: null },
          ];
          return {
            async *[Symbol.asyncIterator]() {
              if (reply.throws) throw reply.throws;
              for (let i = 0; i < text.length; i += 20) {
                yield { type: "content_block_delta", delta: { type: "text_delta", text: text.slice(i, i + 20) } };
              }
            },
            finalMessage: async () =>
              ({
                id: "msg",
                model: "claude-opus-5-5",
                role: "assistant",
                stop_reason: reply.stop ?? "end_turn",
                content,
              }) as never,
          };
        },
      },
    },
  };
  return { client, requests };
}

function plugin(replies: Reply[], apiKey: string | null = "sk-test") {
  const s = stub(replies);
  return { ...s, plugin: fitToPagePlugin({ sdk: async () => sdk, client: () => s.client, apiKey: () => apiKey }) };
}

async function run(
  p: ReturnType<typeof fitToPagePlugin>,
  request = create(TransformRequestSchema, {
    sheet: sheetRecord("Too long.\n".repeat(70), T),
    instruction: "fit",
    attempt: 1,
  }),
) {
  const events = [];
  for await (const e of p.transform(request)) events.push(e);
  return events;
}

test("fit adapter: request uses claude-opus-5-5, medium effort, fallbacks, and the page budget", async () => {
  const { plugin: p, requests } = plugin([{ text: lines(10) }]);
  await run(p);
  const body = requests[0].body;
  assert.equal(body.model, "claude-opus-5-5");
  assert.equal(body.max_tokens, 64000);
  assert.deepEqual(body.output_config, { effort: "medium" });
  assert.deepEqual(body.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(body.fallbacks, "default");
  assert.match(String(body.system), /80 columns and 60 rows/);
  const messages = body.messages as { role: string; content: string }[];
  assert.equal(messages.length, 1);
  assert.match(messages[0].content, /lays out to 71 rows, 11 more than the page holds/);
});

test("fit adapter: streams progress, then one candidate with the reply and resume state", async () => {
  const { plugin: p } = plugin([{ text: lines(30) }]);
  const events = await run(p);
  const progress = events.filter((e) => e.event.case === "progress");
  const candidates = events.filter((e) => e.event.case === "candidate");
  assert.ok(progress.length >= 2);
  assert.equal(candidates.length, 1);
  const candidate = candidates[0].event.value as { text: string; resume: Uint8Array; model: string };
  assert.equal(candidate.text, lines(30));
  assert.equal(candidate.model, "claude-opus-5-5");
  assert.ok(candidate.resume.length > 0);
});

test("fit adapter: a repair appends to the conversation without changing earlier turns", async () => {
  const { plugin: p, requests } = plugin([{ text: lines(64) }, { text: lines(58) }]);
  const first = await run(p);
  const resume = (first.at(-1)!.event.value as { resume: Uint8Array }).resume;
  const repair = create(TransformRequestSchema, {
    sheet: sheetRecord("Too long.\n".repeat(70), T),
    instruction: "fit",
    attempt: 2,
    feedback: { rowsUsed: 64, rowsAllowed: 60 },
    resume,
  });
  await run(p, repair);
  const before = requests[0].body.messages as unknown[];
  const after = requests[1].body.messages as { role: string; content: unknown }[];
  assert.equal(after.length, 3);
  assert.deepEqual(after[0], before[0], "the first user turn is unchanged");
  assert.equal(after[1].role, "assistant");
  assert.deepEqual(
    after[1].content,
    [
      { type: "thinking", thinking: "", signature: "sig-1" },
      { type: "text", text: lines(64), citations: null },
    ],
    "the reply, thinking block included, is appended exactly as returned",
  );
  assert.match(String(after[2].content), /lays out to 64 rows, 4 more than the 60/);
});

test("fit adapter: strips one wrapping code fence", () => {
  assert.equal(stripWrappingFence("```\nPage text\nline 2\n```"), "Page text\nline 2");
  assert.equal(stripWrappingFence("```markdown\nPage\n```\n"), "Page");
  assert.equal(stripWrappingFence("\n\nPage with ``` inside\n\n"), "Page with ``` inside");
  assert.equal(stripWrappingFence("Plain page"), "Plain page");
});

test("fit adapter: without a key nothing is sent", async () => {
  const { plugin: p, requests } = plugin([{ text: "x" }], null);
  await assert.rejects(run(p), (e: unknown) => e instanceof ModelError && e.code === ErrorCode.AUTH);
  assert.equal(requests.length, 0);
});

test("fit adapter: refusal and cut-off replies fail the run", async () => {
  await assert.rejects(
    run(plugin([{ text: "", stop: "refusal" }]).plugin),
    (e: unknown) => e instanceof ModelError && e.code === ErrorCode.REFUSED,
  );
  await assert.rejects(
    run(plugin([{ text: "partial", stop: "max_tokens" }]).plugin),
    (e: unknown) => e instanceof ModelError && e.code === ErrorCode.PLUGIN,
  );
});

test("fit adapter: SDK errors map to the host's codes", () => {
  const cases: [unknown, ErrorCode][] = [
    [new sdk.AuthenticationError(401, undefined, "invalid x-api-key", new Headers()), ErrorCode.AUTH],
    [new sdk.PermissionDeniedError(403, undefined, "forbidden", new Headers()), ErrorCode.AUTH],
    [new sdk.RateLimitError(429, undefined, "rate limited", new Headers()), ErrorCode.NETWORK],
    [new sdk.InternalServerError(500, undefined, "boom", new Headers()), ErrorCode.NETWORK],
    [new sdk.APIConnectionError({ message: "fetch failed" }), ErrorCode.NETWORK],
    [new sdk.APIUserAbortError(), ErrorCode.CANCELED],
    [new sdk.BadRequestError(400, undefined, "bad", new Headers()), ErrorCode.PLUGIN],
    [new Error("other"), ErrorCode.PLUGIN],
  ];
  for (const [error, code] of cases) assert.equal(mapError(sdk, error).code, code, String(error));
});

test("fit adapter: a stream error surfaces as the mapped code", async () => {
  const { plugin: p } = plugin([
    { throws: new sdk.AuthenticationError(401, undefined, "invalid x-api-key", new Headers()) },
  ]);
  await assert.rejects(run(p), (e: unknown) => e instanceof ModelError && e.code === ErrorCode.AUTH);
});

test("fit adapter through the host: consent required, repaired until it fits", async () => {
  const s = stub([{ text: lines(64) }, { text: lines(58) }]);
  const host = new ModelHost();
  host.register({
    card: FIT_TO_PAGE_CARD,
    connect: async () => fitToPagePlugin({ sdk: async () => sdk, client: () => s.client, apiKey: () => "sk-test" }),
  });
  const text = "Too long.\n".repeat(70);
  await assert.rejects(
    host.transform(FIT_TO_PAGE_ID, text, T, { instruction: "fit" }),
    (e: unknown) => e instanceof ModelError && e.code === ErrorCode.CONSENT_REQUIRED,
  );
  assert.equal(s.requests.length, 0);
  const result = await host.transform(FIT_TO_PAGE_ID, text, T, {
    instruction: "fit",
    consent: host.consent.request(FIT_TO_PAGE_ID, Operation.TRANSFORM, text).approve(),
  });
  assert.equal(result.fits, true);
  assert.equal(result.rowsUsed, 58);
  assert.equal(result.attempts, 2);
  assert.equal(s.requests.length, 2);
});

test("fit through the host: the key comes from the host's store, and errors never include it", async () => {
  const key = "sk-ant-api03-SECRET-1234567890";
  const kind = FIT_TO_PAGE.names.credentials.apiKey;
  const failures: unknown[] = [
    new sdk.AuthenticationError(401, undefined, `invalid x-api-key ${key}`, new Headers()),
    new sdk.BadRequestError(400, undefined, `request with ${key} was malformed`, new Headers()),
    new Error(`socket closed while sending ${key}`),
  ];
  const s = stub(failures.map((throws) => ({ throws })));
  const host = new ModelHost();
  host.register({
    card: FIT_TO_PAGE_CARD,
    connect: async (context) =>
      fitToPagePlugin({ sdk: async () => sdk, client: () => s.client, apiKey: () => context.credential(kind) }),
  });
  const text = "Too long.\n".repeat(70);
  const send = () =>
    host.transform(FIT_TO_PAGE_ID, text, T, {
      instruction: "fit",
      consent: host.consent.request(FIT_TO_PAGE_ID, Operation.TRANSFORM, text).approve(),
    });

  // No key yet: nothing is sent.
  await assert.rejects(send(), (e: unknown) => e instanceof ModelError && e.code === ErrorCode.AUTH);
  assert.equal(s.requests.length, 0);

  host.credentials.set(FIT_TO_PAGE_ID, kind, `  ${key}  `);
  assert.equal(host.credentials.has(FIT_TO_PAGE_ID, kind), true);
  for (let i = 0; i < failures.length; i++) {
    const error = await send().then(
      () => assert.fail("expected a failure"),
      (e: unknown) => e,
    );
    assert.ok(error instanceof ModelError);
    for (const shown of [error.message, String(error), error.stack ?? "", String(error.cause ?? "")]) {
      assert.ok(!shown.includes(key), `failure ${i} shows the key: ${shown}`);
    }
  }
  assert.equal(s.requests.length, failures.length);

  host.credentials.forget(FIT_TO_PAGE_ID, kind);
  assert.equal(host.credentials.has(FIT_TO_PAGE_ID, kind), false);
});

test("the host keeps credentials only for kinds the card declares, and a new host has none", () => {
  const host = new ModelHost();
  host.register({ card: FIT_TO_PAGE_CARD, connect: async () => fitToPagePlugin({ apiKey: () => null }) });
  assert.throws(
    () => host.credentials.set(FIT_TO_PAGE_ID, "password", "x"),
    (e: unknown) => e instanceof ModelError && e.code === ErrorCode.INVALID_CARD,
  );
  host.credentials.set(FIT_TO_PAGE_ID, FIT_TO_PAGE.names.credentials.apiKey, "sk-test");
  const reloaded = new ModelHost();
  reloaded.register({ card: FIT_TO_PAGE_CARD, connect: async () => fitToPagePlugin({ apiKey: () => null }) });
  assert.equal(reloaded.credentials.has(FIT_TO_PAGE_ID, FIT_TO_PAGE.names.credentials.apiKey), false);
});
