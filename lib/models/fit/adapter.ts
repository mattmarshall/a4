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
import { layoutRows } from "../../text.ts";
import { implement, type SheetModelClient } from "../client.ts";
import { ModelError } from "../errors.ts";
import { FIT_HOST, FIT_MODEL, FIT_TO_PAGE_CARD } from "./card.ts";
import { currentApiKey } from "./key.ts";
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
        options?: { signal?: AbortSignal },
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
  /** The author's key (in-memory by default). */
  apiKey?: () => string | null;
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
  throw new ModelError("invalid-result", "Fit to page couldn't read its previous attempt.");
}

/** Map SDK failures to the host's error codes, most specific first. */
export function mapError(sdk: Sdk, error: unknown, signal?: AbortSignal): ModelError {
  if (error instanceof ModelError) return error;
  if (error instanceof sdk.APIUserAbortError || signal?.aborted)
    return new ModelError("cancelled", "Canceled.", { cause: error });
  if (error instanceof sdk.AuthenticationError || error instanceof sdk.PermissionDeniedError) {
    return new ModelError("auth", "Anthropic didn’t accept the API key.", { cause: error });
  }
  if (error instanceof sdk.RateLimitError) {
    return new ModelError("network", "Anthropic is rate limiting requests. Try again in a minute.", { cause: error });
  }
  if (error instanceof sdk.APIConnectionError)
    return new ModelError("network", `Couldn’t reach ${FIT_HOST}.`, { cause: error });
  if (error instanceof sdk.APIError) {
    const status = typeof error.status === "number" ? error.status : 0;
    if (status >= 500)
      return new ModelError("network", "Anthropic’s API is unavailable right now. Try again shortly.", {
        cause: error,
      });
    return new ModelError("plugin", `Anthropic returned an error${status ? ` (${status})` : ""}: ${error.message}`, {
      cause: error,
    });
  }
  return new ModelError("plugin", error instanceof Error ? error.message : String(error), { cause: error });
}

export function fitToPagePlugin(deps: FitDeps = {}): SheetModelClient {
  const loadSdk = deps.sdk ?? (() => import("@anthropic-ai/sdk"));
  const makeClient =
    deps.client ??
    ((sdk: Sdk, apiKey: string) =>
      // The author's own key, entered for this tab: the case the SDK's browser opt-in exists for.
      new sdk.default({ apiKey, dangerouslyAllowBrowser: true }) as unknown as StreamingClient);
  const keyOf = deps.apiKey ?? currentApiKey;

  return implement({
    describe: () => ({ card: FIT_TO_PAGE_CARD }),

    async *transform(request, signal) {
      const key = keyOf();
      if (!key) throw new ModelError("auth", "Enter your Anthropic API key first.");
      const sheet = request.sheet;
      if (!sheet?.spec) throw new ModelError("invalid-result", "Fit to page needs a sheet with a page spec.");
      const shape = { cols: sheet.spec.cols, rows: sheet.spec.rows };

      const history: MessageParam[] = request.resume.length ? decodeHistory(request.resume) : [];
      if (!history.length) {
        history.push({
          role: "user",
          content: firstRequest(sheet.text, layoutRows(sheet.text, shape.cols).length, shape),
        });
      } else {
        const feedback = request.feedback;
        if (!feedback) throw new ModelError("invalid-result", "A repair attempt needs fit feedback.");
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
        throw mapError(sdk, error, signal);
      }

      if (message.stop_reason === "refusal") throw new ModelError("refused", "Claude declined to rewrite this page.");
      if (message.stop_reason === "max_tokens")
        throw new ModelError("plugin", "The rewrite was cut off before it finished.");
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
