/**
 * Fit to page: a Transform plugin that asks Claude to rewrite the page so it
 * fits. Runs in the browser and calls api.anthropic.com directly with the
 * author's own key; the host only lets it run with a fresh consent token.
 *
 * The plugin is stateless: its full conversation (each reply's content
 * blocks, appended unchanged, as preserved thinking requires) travels in the
 * candidate's opaque `resume` bytes, and the host passes it back with the
 * fit feedback for a repair.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { layoutRows } from "../../../page/index.ts";
import { implement, type SheetModelClient } from "../../client.ts";
import { ErrorCode, ModelError } from "../../errors.ts";
import { readTextSheet } from "../../sheet-input.ts";
import { FIT_HOST, FIT_MODEL, FIT_TO_PAGE_CARD } from "./descriptor.ts";
import { firstRequest, repairRequest, stripWrappingFence, systemPrompt } from "./prompt.ts";

type Sdk = typeof import("@anthropic-ai/sdk");
type MessageParam = Anthropic.Beta.BetaMessageParam;
type StreamParams = Parameters<Anthropic["beta"]["messages"]["stream"]>[0];

/** The part of the SDK client this plugin uses (a stub in tests). */
export interface StreamingClient {
  beta: {
    messages: {
      stream(
        body: StreamParams,
        options?: { signal?: AbortSignal | undefined },
      ): AsyncIterable<{ type: string; delta?: { type: string; text?: string } }> & {
        finalMessage(): Promise<Anthropic.Beta.BetaMessage>;
      };
    };
  };
}

export interface FitDeps {
  /** Load the SDK module (a dynamic import by default, so it loads on first use). */
  sdk?: () => Promise<Sdk>;
  /** Build a client for a key. */
  client?: (sdk: Sdk, apiKey: string) => StreamingClient;
  /** The author's key, from the host's credential store. */
  apiKey: () => string | null;
}

/** Progress is reported every this many characters written. */
const PROGRESS_STEP = 40;

function encodeHistory(history: MessageParam[]): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(history));
}

function decodeHistory(bytes: Uint8Array): MessageParam[] {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (Array.isArray(parsed)) return parsed as MessageParam[];
  } catch {
    // fall through
  }
  throw new ModelError(ErrorCode.INVALID_RESULT, "Fit to page couldn't read its previous attempt.");
}

/** Map SDK failures to the host's error codes, most specific first. */
export function mapError(sdk: Sdk, error: unknown, signal?: AbortSignal): ModelError {
  if (error instanceof ModelError) return error;
  if (error instanceof sdk.APIUserAbortError || signal?.aborted)
    return new ModelError(ErrorCode.CANCELED, "Canceled.", { cause: error });
  if (error instanceof sdk.AuthenticationError || error instanceof sdk.PermissionDeniedError) {
    return new ModelError(ErrorCode.AUTH, "Anthropic didn’t accept the API key.", { cause: error });
  }
  if (error instanceof sdk.RateLimitError) {
    return new ModelError(ErrorCode.NETWORK, "Anthropic is rate limiting requests. Try again in a minute.", {
      cause: error,
    });
  }
  if (error instanceof sdk.APIConnectionError)
    return new ModelError(ErrorCode.NETWORK, `Couldn’t reach ${FIT_HOST}.`, { cause: error });
  if (error instanceof sdk.APIError) {
    const status = typeof error.status === "number" ? error.status : 0;
    if (status >= 500)
      return new ModelError(ErrorCode.NETWORK, "Anthropic’s API is unavailable right now. Try again shortly.", {
        cause: error,
      });
    return new ModelError(
      ErrorCode.PLUGIN,
      `Anthropic returned an error${status ? ` (${status})` : ""}: ${error.message}`,
      {
        cause: error,
      },
    );
  }
  return new ModelError(ErrorCode.PLUGIN, error instanceof Error ? error.message : String(error), { cause: error });
}

/** `error` with every copy of `key` removed from its message, and no cause that holds it. */
function withoutKey(error: ModelError, key: string): ModelError {
  const cause: unknown = error.cause;
  const causeMessage = cause instanceof Error ? cause.message : String(cause ?? "");
  if (!error.message.includes(key) && !causeMessage.includes(key)) return error;
  return new ModelError(error.code, error.message.split(key).join("[key]"));
}

export function fitToPagePlugin(deps: FitDeps): SheetModelClient {
  const loadSdk = deps.sdk ?? (() => import("@anthropic-ai/sdk"));
  const makeClient =
    deps.client ??
    ((sdk: Sdk, apiKey: string) =>
      // The author's own key, entered for this tab: the case the SDK's browser opt-in exists for.
      new sdk.default({ apiKey, dangerouslyAllowBrowser: true }) as unknown as StreamingClient);
  const keyOf = deps.apiKey;

  return implement({
    describe: () => ({ card: FIT_TO_PAGE_CARD }),

    async *transform(request, signal) {
      const key = keyOf();
      if (!key) throw new ModelError(ErrorCode.AUTH, "Enter your Anthropic API key first.");
      const { text, spec } = readTextSheet(request.sheet, "Fit to page");
      const shape = { cols: spec.cols, rows: spec.rows };

      const history: MessageParam[] = request.resume.length ? decodeHistory(request.resume) : [];
      if (!history.length) {
        history.push({
          role: "user",
          content: firstRequest(text, layoutRows(text, shape.cols).length, shape),
        });
      } else {
        const feedback = request.feedback;
        if (!feedback) throw new ModelError(ErrorCode.INVALID_RESULT, "A repair attempt needs fit feedback.");
        history.push({ role: "user", content: repairRequest(feedback.rowsUsed, feedback.rowsAllowed) });
      }

      const sdk = await loadSdk();
      let message: Anthropic.Beta.BetaMessage;
      try {
        const stream = makeClient(sdk, key).beta.messages.stream(
          {
            model: FIT_MODEL,
            max_tokens: 64000,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            output_config: { effort: "medium" },
            system: systemPrompt(shape),
            messages: history,
          },
          { signal },
        );
        let characters = 0;
        let reported = 0;
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
            characters += event.delta.text?.length ?? 0;
            if (characters - reported >= PROGRESS_STEP) {
              reported = characters;
              yield { event: { case: "progress", value: { characters } } };
            }
          }
        }
        message = await stream.finalMessage();
      } catch (error) {
        throw withoutKey(mapError(sdk, error, signal), key);
      }

      if (message.stop_reason === "refusal")
        throw new ModelError(ErrorCode.REFUSED, "Claude declined to rewrite this page.");
      if (message.stop_reason === "max_tokens")
        throw new ModelError(ErrorCode.PLUGIN, "The rewrite was cut off before it finished.");
      const reply = message.content
        .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");
      // Append the reply exactly as returned: the conversation stays append-only.
      history.push({ role: "assistant", content: message.content } as unknown as MessageParam);
      yield {
        event: {
          case: "candidate",
          value: { text: stripWrappingFence(reply), resume: encodeHistory(history), model: message.model },
        },
      };
    },
  });
}
