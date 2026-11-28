/**
 * The served library in English (README, "Served library"): the Pages
 * panel's switch, the Connect form, a bad connect link, and why a served
 * library can't be used, with what to do. A notice says why after a switch,
 * a connect link, or a refusal while shown; the Connect form says it inline.
 * Both start with the error's own sentence, written once in `lib/`, and add
 * only what to do there.
 *
 * Relative imports, so Node's test runner can load this file.
 */

import { APP_ORIGIN, type UnavailableReason } from "../lib/persist/index.ts";

/** The Pages panel's switch between this browser's library and the served one. */
export const servedSwitch = {
  /** The section's label for assistive technology. */
  region: "Library",
  label: "Show pages from",
  browser: "This browser",
  served: "a4 serve",
  servedTitle: (address: string) => `The library a4 serve serves at ${address}`,
  disconnect: "Disconnect",
  connect: "Connect a4 serve…",
  connectTitle: "Show a library of Markdown files served by a4 serve on this machine",
} as const;

/** What a failed library command was doing, for its notice: "Couldn’t connect to a4 serve: …". */
export const servedActions = {
  switchToBrowser: "switch to this browser’s library",
  switchToServed: "switch to the served library",
  connect: "connect to a4 serve",
  disconnect: "disconnect from a4 serve",
} as const;

/** The Connect form, for when the link `a4 serve` prints can't be clicked. */
export const connectForm = {
  /** The hint, with the command apart so it can show as code. */
  hint: {
    before: "Run ",
    command: "a4 serve <folder>",
    after:
      " and open the link it prints, or enter its address and token here. The token is the end of the link, after the last dot.",
  },
  addressLabel: "a4 serve address",
  tokenLabel: "Token",
  connect: "Connect",
  cancel: "Cancel",
} as const;

/** The Connect form's error for an address or token that can't be a4 serve's. */
export function badConnection(port: number): string {
  return `Enter the address a4 serve printed, such as 127.0.0.1:${port}, and its 43-character token.`;
}

/** A connect link that doesn't name a4 serve on this machine. */
export const BAD_CONNECT_LINK =
  "This connect link can’t be used: it must name a4 serve on this machine (127.0.0.1 or localhost) and its token.";

const SHOWN = "Showing this browser’s library.";

/**
 * For a server A4 can't reach, from a page not served from A4's own origin:
 * it may be running without `--origin` for this page, whose requests the
 * browser then blocks as if it weren't running. The hint, and the command
 * to run.
 */
function notRunning(pageOrigin: string): { readonly hint: string; readonly command: string } {
  return pageOrigin === APP_ORIGIN
    ? { hint: "", command: "a4 serve <folder>" }
    : { hint: " If it’s running, it may not allow this page.", command: `a4 serve <folder> --origin ${pageOrigin}` };
}

/**
 * The notice after a switch, a connect link, or a refusal while shown: why
 * (`message`, the error's own sentence), that this browser's library is
 * shown, and what to do. `pageOrigin` is the origin of the page A4 runs in.
 */
export function unavailableNotice(reason: UnavailableReason | null, message: string, pageOrigin: string): string {
  switch (reason) {
    case null:
      return `${message} ${SHOWN}`;
    case "not-running": {
      const { hint, command } = notRunning(pageOrigin);
      return `${message}${hint} ${SHOWN} Run “${command}”, then switch in the Pages panel (or open the link it prints).`;
    }
    case "refused":
      return `${message} It was probably restarted with --new-token. ${SHOWN} Open the link it printed to connect again.`;
    case "older-server":
      return `${message} ${SHOWN} Update your A4 checkout, restart a4 serve, then switch in the Pages panel.`;
    case "newer-server":
      return `${message} ${SHOWN} Reload A4, then switch in the Pages panel.`;
    case "bad-answer":
      return `${message} ${SHOWN} Restart a4 serve, and update your A4 checkout if that doesn’t help.`;
  }
}

/** The notice after the poller finds another library served behind the same connection, and shows it. */
export function servedReplaced(address: string): string {
  return `a4 serve at ${address} now serves another library, so its pages are shown. Edits to the other one stay with it, for when it’s served again.`;
}

/** The Connect form's error when its check fails: why (the error's own sentence), and what to do before choosing Connect again. */
export function connectFailed(reason: UnavailableReason | null, message: string, pageOrigin: string): string {
  switch (reason) {
    case null:
      return message;
    case "not-running": {
      const { hint, command } = notRunning(pageOrigin);
      return `${message}${hint} Start it with “${command}”, then choose Connect again.`;
    }
    case "refused":
      return `${message} Check the token: it’s the end of the link a4 serve printed, after the last dot.`;
    case "older-server":
      return `${message} Update your A4 checkout and restart a4 serve, then choose Connect again.`;
    case "newer-server":
      return `${message} Reload A4, then connect again.`;
    case "bad-answer":
      return `${message} Restart a4 serve, and update your A4 checkout if that doesn’t help.`;
  }
}
