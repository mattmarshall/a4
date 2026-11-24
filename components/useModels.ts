"use client";

/**
 * Model host state for the workbench: each on-device plugin's status,
 * download progress, and calls into the host. The host (and each plugin's
 * code) loads lazily; listing cards loads nothing.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ModelHost, ScoreResult } from "@/lib/models/host";
import { BUNDLED_CARDS, MODEL_DOWNLOADED } from "@/lib/models/cards";
import { pluginIdOf, type PluginId } from "@/lib/models/plugin-id";
import type { PageSpec } from "@/lib/page-spec";

export type ModelStatus = "checking" | "not-downloaded" | "downloading" | "ready" | "error";

export interface ModelsState {
  status: Record<string, ModelStatus>;
  progress: Record<string, { loaded: number; total: number }>;
  errors: Record<string, string>;
  /** Download and load a plugin's model files. Only call after the author asks. */
  prepare: (id: PluginId) => Promise<void>;
  score: (id: PluginId, text: string, spec: PageSpec) => Promise<ScoreResult>;
  host: () => Promise<ModelHost>;
}

export function useModels(): ModelsState {
  const [status, setStatus] = useState<Record<string, ModelStatus>>({});
  const [progress, setProgress] = useState<Record<string, { loaded: number; total: number }>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const hostPromise = useRef<Promise<ModelHost> | null>(null);

  const host = useCallback(() => {
    // The server render never needs models; this keeps the registry (and the
    // worker and model runtime behind it) out of the server bundle entirely.
    if (import.meta.env.SSR) return Promise.reject(new Error("Models run only in the browser."));
    hostPromise.current ??= import("@/lib/models/registry").then((m) => m.modelHost());
    return hostPromise.current;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const card of BUNDLED_CARDS) {
        if (card.sendsTextOffDevice) continue; // remote plugins have nothing to download
        setStatus((s) => ({ ...s, [card.id]: "checking" }));
        try {
          // Start the plugin only if its model is already downloaded; then its
          // worker can also fetch its code while the page is online.
          const downloaded = (await MODEL_DOWNLOADED[card.id]?.()) ?? true;
          const ready = downloaded && (await (await host()).status(pluginIdOf(card)));
          if (!cancelled) setStatus((s) => ({ ...s, [card.id]: ready ? "ready" : "not-downloaded" }));
        } catch (error) {
          if (cancelled) return;
          setStatus((s) => ({ ...s, [card.id]: "error" }));
          setErrors((e) => ({ ...e, [card.id]: error instanceof Error ? error.message : String(error) }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [host]);

  const prepare = useCallback(
    async (id: PluginId) => {
      setStatus((s) => ({ ...s, [id]: "downloading" }));
      setErrors((e) => {
        const { [id]: _, ...rest } = e;
        return rest;
      });
      try {
        await (await host()).prepare(id, (loaded, total) => setProgress((p) => ({ ...p, [id]: { loaded, total } })));
        setStatus((s) => ({ ...s, [id]: "ready" }));
      } catch (error) {
        setStatus((s) => ({ ...s, [id]: "not-downloaded" }));
        setErrors((e) => ({ ...e, [id]: error instanceof Error ? error.message : String(error) }));
      }
    },
    [host],
  );

  const score = useCallback(
    async (id: PluginId, text: string, spec: PageSpec) => (await host()).score(id, text, spec),
    [host],
  );

  return { status, progress, errors, prepare, score, host };
}
