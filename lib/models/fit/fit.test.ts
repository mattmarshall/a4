import assert from "node:assert/strict";
import { test } from "node:test";
import { create } from "@bufbuild/protobuf";
import * as sdk from "@anthropic-ai/sdk";
import { TransformRequestSchema } from "../../gen/a4/v1/model_pb.js";
import { PRESETS } from "../../page-spec.ts";
import { sheetRecord } from "../../tensor/record.ts";
import { grantConsent } from "../consent.ts";
import { ModelError, type ModelErrorCode } from "../errors.ts";
import { ModelHost } from "../host.ts";
import { fitToPagePlugin, mapError, type StreamingClient } from "./adapter.ts";
import { FIT_TO_PAGE_CARD, FIT_TO_PAGE_ID } from "./card.ts";
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
  const requests: { body: Record<string, unknown>; signal?: AbortSignal }[] = [];
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
              ({ id: "msg", model: "claude-opus-5-5", role: "assistant", stop_reason: reply.stop ?? "end_turn", content }) as never,
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

async function run(p: ReturnType<typeof fitToPagePlugin>, request = create(TransformRequestSchema, { sheet: sheetRecord("Too long.\n".repeat(70), T), instruction: "fit", attempt: 1 })) {
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
  await assert.rejects(run(p), (e: unknown) => e instanceof ModelError && e.code === "auth");
  assert.equal(requests.length, 0);
});

test("fit adapter: refusal and cut-off replies fail the run", async () => {
  await assert.rejects(run(plugin([{ text: "", stop: "refusal" }]).plugin), (e: unknown) => e instanceof ModelError && e.code === "refused");
  await assert.rejects(run(plugin([{ text: "partial", stop: "max_tokens" }]).plugin), (e: unknown) => e instanceof ModelError && e.code === "plugin");
});

test("fit adapter: SDK errors map to the host's codes", () => {
  const cases: [unknown, ModelErrorCode][] = [
    [new sdk.AuthenticationError(401, undefined, "invalid x-api-key", new Headers()), "auth"],
    [new sdk.PermissionDeniedError(403, undefined, "forbidden", new Headers()), "auth"],
    [new sdk.RateLimitError(429, undefined, "rate limited", new Headers()), "network"],
    [new sdk.InternalServerError(500, undefined, "boom", new Headers()), "network"],
    [new sdk.APIConnectionError({ message: "fetch failed" }), "network"],
    [new sdk.APIUserAbortError(), "cancelled"],
    [new sdk.BadRequestError(400, undefined, "bad", new Headers()), "plugin"],
    [new Error("other"), "plugin"],
  ];
  for (const [error, code] of cases) assert.equal(mapError(sdk, error).code, code, String(error));
});

test("fit adapter: a stream error surfaces as the mapped code", async () => {
  const { plugin: p } = plugin([{ throws: new sdk.AuthenticationError(401, undefined, "invalid x-api-key", new Headers()) }]);
  await assert.rejects(run(p), (e: unknown) => e instanceof ModelError && e.code === "auth");
});

test("fit adapter through the host: consent required, repaired until it fits", async () => {
  const s = stub([{ text: lines(64) }, { text: lines(58) }]);
  const host = new ModelHost();
  host.register({
    card: FIT_TO_PAGE_CARD,
    connect: async () => fitToPagePlugin({ sdk: async () => sdk, client: () => s.client, apiKey: () => "sk-test" }),
  });
  const text = "Too long.\n".repeat(70);
  await assert.rejects(host.transform(FIT_TO_PAGE_ID, text, T, { instruction: "fit" }), (e: unknown) => e instanceof ModelError && e.code === "consent-required");
  assert.equal(s.requests.length, 0);
  const result = await host.transform(FIT_TO_PAGE_ID, text, T, { instruction: "fit", consent: grantConsent(FIT_TO_PAGE_ID, text) });
  assert.equal(result.fits, true);
  assert.equal(result.rowsUsed, 58);
  assert.equal(result.attempts, 2);
  assert.equal(s.requests.length, 2);
});
