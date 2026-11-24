/**
 * Consent for plugins that send page text off the device. A token is minted
 * only by `grantConsent` (called from the consent dialog's Send handler), is
 * bound to one plugin and one exact page text, and works once. The host
 * refuses a remote call without a fresh, matching token, so "confirm every
 * call" is structural rather than a UI convention.
 */

import { revisionOf } from "../store/revision.ts";
import type { Revision } from "../store/types.ts";
import { ErrorCode, ModelError } from "./errors.ts";
import type { PluginId } from "./plugin-id.ts";

export interface ConsentToken {
  readonly pluginId: PluginId;
  readonly revision: Revision;
  readonly characters: number;
}

// Tokens the dialog actually issued and that haven't been used yet. An object
// literal shaped like a token is never in this set.
const live = new WeakSet<ConsentToken>();

/** Mint a single-use token for sending exactly `text` to `pluginId`. */
export function grantConsent(pluginId: PluginId, text: string): ConsentToken {
  const token: ConsentToken = Object.freeze({ pluginId, revision: revisionOf(text), characters: text.length });
  live.add(token);
  return token;
}

/**
 * Use up a token for sending `text` to `pluginId`. Throws "consent-required"
 * when the token is missing, already used, forged, or for other text.
 */
export function consumeConsent(token: ConsentToken | undefined, pluginId: PluginId, text: string): void {
  if (!token || !live.has(token))
    throw new ModelError(
      ErrorCode.CONSENT_REQUIRED,
      "This model sends the page off the device; confirm the request first.",
    );
  live.delete(token);
  if (token.pluginId !== pluginId)
    throw new ModelError(ErrorCode.CONSENT_REQUIRED, "The confirmation was for a different model.");
  if (token.characters !== text.length || token.revision !== revisionOf(text)) {
    throw new ModelError(ErrorCode.CONSENT_REQUIRED, "The page changed after you confirmed; confirm again.");
  }
}
