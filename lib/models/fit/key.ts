/**
 * The author's Anthropic API key, held in this module's memory for the tab's
 * lifetime only. It is never written to storage, page files, exports, the
 * journal, or logs, and a reload forgets it.
 */

let apiKey: string | null = null;

export function setApiKey(key: string): void {
  const trimmed = key.trim();
  apiKey = trimmed ? trimmed : null;
}

export function hasApiKey(): boolean {
  return apiKey !== null;
}

export function forgetApiKey(): void {
  apiKey = null;
}

/** For the adapter only. */
export function currentApiKey(): string | null {
  return apiKey;
}
