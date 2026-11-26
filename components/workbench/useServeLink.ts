"use client";

/**
 * The connect link `a4 serve` prints (README, "Served library"):
 * `<origin>/#serve=127.0.0.1:4320.<token>`. It's read when the app loads and
 * whenever the fragment changes. The fragment is cleared at once, so the
 * token doesn't stay in the address bar or the history, and the connection is
 * made once the workspace is ready. The token never leaves this browser
 * except to the address in the link, which must be on this machine.
 */

import { useEffect, useState } from "react";
import { parseServedConnection, type ServedConnection } from "@/lib/persist";
import type { Notify } from "@/lib/workspace";

const PREFIX = "#serve=";

/** Remove the fragment from the address bar without reloading or adding a history entry. */
function clearFragment(): void {
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
}

export function useServeLink(
  ready: boolean,
  connect: (connection: ServedConnection) => Promise<unknown>,
  notify: Notify,
): void {
  const [pending, setPending] = useState<ServedConnection | null>(null);

  useEffect(() => {
    const read = () => {
      const hash = window.location.hash;
      if (!hash.startsWith(PREFIX)) return;
      clearFragment();
      const connection = parseServedConnection(decodeURIComponent(hash.slice(PREFIX.length)));
      if (connection) setPending(connection);
      else
        notify(
          "This connect link can’t be used: it must name a4 serve on this machine (127.0.0.1 or localhost) and its token.",
          "warn",
        );
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [notify]);

  useEffect(() => {
    if (!ready || !pending) return;
    setPending(null);
    void connect(pending);
  }, [ready, pending, connect]);
}
