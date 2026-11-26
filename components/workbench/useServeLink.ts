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
import { readConnectFragment, type ServedConnection } from "@/lib/persist";
import type { Notify } from "@/lib/workspace";
import { clearFragment } from "./fragment";

export function useServeLink(
  ready: boolean,
  connect: (connection: ServedConnection) => Promise<unknown>,
  notify: Notify,
): void {
  const [pending, setPending] = useState<ServedConnection | null>(null);

  useEffect(() => {
    const read = () => {
      const connection = readConnectFragment(window.location.hash);
      if (connection === null) return;
      clearFragment();
      if (connection !== "invalid") setPending(connection);
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
