/**
 * A served library's connection (README, "Served library"): where `a4 serve`
 * listens on this machine, and the library's token. The connect link and the
 * `servedLibrary` setting carry it as "<address>.<token>", such as
 * "127.0.0.1:4320.<43 base64url characters>".
 *
 * Only a loopback address is accepted, so a link can't point the app at
 * another machine: page text goes only to this one.
 */

export { APP_ORIGIN } from "../../platform/origin.ts";

/** The port `a4 serve` listens on unless told otherwise. */
export const DEFAULT_SERVE_PORT = 4320;

/** A connect link's fragment starts with this, then "<address>.<token>". */
const FRAGMENT = "#serve=";

export interface ServedConnection {
  /** "127.0.0.1:<port>" or "localhost:<port>". */
  readonly address: string;
  readonly token: string;
}

const ADDRESS = /^(127\.0\.0\.1|localhost):(\d{1,5})$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Whether `text` is a library's token: 32 random bytes as 43 base64url characters. */
export function isServedToken(text: string): boolean {
  return TOKEN.test(text);
}

/** A loopback address with a port from 1 to 65535, or null. */
function parseServedAddress(raw: string): string | null {
  const match = ADDRESS.exec(raw.trim());
  if (!match) return null;
  const port = Number(match[2]);
  return port >= 1 && port <= 65535 ? `${match[1]}:${port}` : null;
}

/** A connection from an address and a token typed or pasted separately, or null when either isn't valid. */
export function servedConnection(address: string, token: string): ServedConnection | null {
  const parsed = parseServedAddress(address);
  const trimmed = token.trim();
  return parsed && TOKEN.test(trimmed) ? { address: parsed, token: trimmed } : null;
}

/** "<address>.<token>" as a link or the setting carries it, or null. */
export function parseServedConnection(raw: string): ServedConnection | null {
  const dot = raw.lastIndexOf(".");
  return dot < 0 ? null : servedConnection(raw.slice(0, dot), raw.slice(dot + 1));
}

export function formatServedConnection(connection: ServedConnection): string {
  return `${connection.address}.${connection.token}`;
}

/** The link that connects the app at `origin` to the served library: the connection rides in the fragment. */
export function connectLink(origin: string, connection: ServedConnection): string {
  return `${origin.replace(/\/+$/, "")}/${FRAGMENT}${formatServedConnection(connection)}`;
}

/**
 * A URL fragment as a connect link: its connection, "invalid" for a
 * `#serve=` fragment that can't be used (not on this machine, a bad token,
 * or a broken escape), or null for any other fragment.
 */
export function readConnectFragment(hash: string): ServedConnection | "invalid" | null {
  if (!hash.startsWith(FRAGMENT)) return null;
  let raw: string;
  try {
    raw = decodeURIComponent(hash.slice(FRAGMENT.length));
  } catch {
    return "invalid";
  }
  return parseServedConnection(raw) ?? "invalid";
}

export function sameConnection(a: ServedConnection | null, b: ServedConnection | null): boolean {
  return a?.address === b?.address && a?.token === b?.token;
}
