/**
 * The served library in English (README, "Served library"): the Pages
 * panel's switch, the Connect form, a bad connect link, and why a served
 * library can't be used, with what to do. A notice says why after a switch
 * or a connect link; the Connect form says it inline. Both build on one cause
 * for each reason.
 *
 * Relative imports, so Node's test runner can load this file.
 */

import type { UnavailableReason } from "../lib/persist/index.ts";

/** The Pages panel's switch between this browser's library and the served one. */
export const servedSwitch = {
  label: "Show pages from",
  browser: "This browser",
  served: "a4 serve",
  servedTitle: (address: string) => `The library a4 serve serves at ${address}`,
  disconnect: "Disconnect",
  connect: "Connect a4 serve…",
  connectTitle: "Show a library of Markdown files served by a4 serve on this machine",
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

/**
 * Why the served library at `address` can't be used, for every reason but a
 * refused token, whose wording depends on where it's said. `message` is the
 * error's own sentence, which already names a server that isn't running.
 */
function cause(reason: Exclude<UnavailableReason, "refused">, address: string, message: string): string {
  const at = `a4 serve at ${address}`;
  switch (reason) {
    case "not-running":
      return message;
    case "older-server":
      return `${at} is older than this A4.`;
    case "newer-server":
      return `${at} is newer than this A4.`;
    case "bad-answer":
      return `${at} sent an answer A4 can’t read.`;
  }
}

const SHOWN = "Showing this browser’s library.";

/** The notice after a switch or a connect link: why, that this browser's library is shown, and what to do. */
export function unavailableNotice(reason: UnavailableReason | null, address: string, message: string): string {
  switch (reason) {
    case null:
      return `${message} ${SHOWN}`;
    case "not-running":
      return `${cause(reason, address, message)} ${SHOWN} Run “a4 serve <folder>”, then switch in the Pages panel (or open the link it prints).`;
    case "refused":
      return `a4 serve at ${address} refused this browser’s token: it was probably restarted with --new-token. ${SHOWN} Open the link it printed to connect again.`;
    case "older-server":
      return `${cause(reason, address, message)} ${SHOWN} Update your A4 checkout, restart a4 serve, then switch in the Pages panel.`;
    case "newer-server":
      return `${cause(reason, address, message)} ${SHOWN} Reload A4, then switch in the Pages panel.`;
    case "bad-answer":
      return `${cause(reason, address, message)} ${SHOWN} Restart a4 serve, and update your A4 checkout if that doesn’t help.`;
  }
}

/** The Connect form's error when its check fails: why, and what to do before choosing Connect again. */
export function connectFailed(reason: UnavailableReason | null, address: string, message: string): string {
  switch (reason) {
    case null:
      return message;
    case "not-running":
      return `${cause(reason, address, message)} Start it with “a4 serve <folder>”, then choose Connect again.`;
    case "refused":
      return `a4 serve at ${address} refused this token. Check it: it’s the end of the link a4 serve printed, after the last dot.`;
    case "older-server":
      return `${cause(reason, address, message)} Update your A4 checkout and restart a4 serve, then choose Connect again.`;
    case "newer-server":
      return `${cause(reason, address, message)} Reload A4, then connect again.`;
    case "bad-answer":
      return `${cause(reason, address, message)} Restart a4 serve, and update your A4 checkout if that doesn’t help.`;
  }
}
