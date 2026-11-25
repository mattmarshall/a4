/**
 * Consent for plugins that send page text off the device, owned by the host.
 *
 * The host hands out requests (`host.consent.request`). Only the consent
 * dialog approves one, and only once, which mints a token bound to one
 * plugin, one operation, and the exact text (compared by value). The host's
 * egress guard consumes the token before it contacts the plugin, so "confirm
 * every call" is structural, not a UI convention. Tokens are single-use, and
 * an object shaped like a token is never accepted.
 */

import type { Operation } from "../gen/a4/v1/model_pb.js";
import { ErrorCode, ModelError } from "./errors.ts";
import type { PluginId } from "./plugin-id.ts";

export interface ConsentToken {
  readonly pluginId: PluginId;
  readonly operation: Operation;
  readonly text: string;
}

/** A pending request to send exactly one text to one plugin for one operation. */
export interface ConsentRequest {
  readonly pluginId: PluginId;
  readonly operation: Operation;
  readonly characters: number;
  /** Approve the request, once: the consent dialog's Send. */
  approve(): ConsentToken;
}

const refused = (message: string) => new ModelError(ErrorCode.CONSENT_REQUIRED, message);

export class ConsentBroker {
  // Tokens approved and not yet used. An object shaped like a token is never here.
  readonly #live = new WeakSet<ConsentToken>();
  // When each token was approved, and when each plugin was last removed: a
  // token approved before its plugin was removed is refused.
  readonly #issued = new WeakMap<ConsentToken, number>();
  readonly #revoked = new Map<PluginId, number>();
  #sequence = 0;

  /** Refuse every token approved so far for `pluginId`: its plugin was removed. */
  revoke(pluginId: PluginId): void {
    this.#revoked.set(pluginId, this.#sequence);
  }

  request(pluginId: PluginId, operation: Operation, text: string): ConsentRequest {
    const live = this.#live;
    const issued = this.#issued;
    const next = () => ++this.#sequence;
    let approved = false;
    return Object.freeze({
      pluginId,
      operation,
      characters: text.length,
      approve(): ConsentToken {
        if (approved) throw refused("This request was already approved; confirm again.");
        approved = true;
        const token: ConsentToken = Object.freeze({ pluginId, operation, text });
        live.add(token);
        issued.set(token, next());
        return token;
      },
    });
  }

  /**
   * Use up `token` for sending `text` to `pluginId` for `operation`. Throws
   * "consent required" when the token is missing, used, forged, or for another
   * plugin, operation, or text.
   */
  consume(token: ConsentToken | undefined, pluginId: PluginId, operation: Operation, text: string): void {
    if (!token || !this.#live.has(token)) {
      throw refused("This model sends the page off the device; confirm the request first.");
    }
    this.#live.delete(token);
    if ((this.#issued.get(token) ?? 0) <= (this.#revoked.get(token.pluginId) ?? 0)) {
      throw refused("This model was removed after you confirmed; confirm again.");
    }
    if (token.pluginId !== pluginId || token.operation !== operation) {
      throw refused("The confirmation was for a different model or request.");
    }
    if (token.text !== text) throw refused("The page changed after you confirmed; confirm again.");
  }
}
