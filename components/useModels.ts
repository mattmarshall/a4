"use client";

/**
 * Model host state for the workbench: each plugin's status and download
 * progress, the author's installed plugins, and calls into the host. The host
 * (and each plugin's code) loads lazily; listing bundled cards loads nothing,
 * and the registry loads at start only when this browser has installed
 * plugins to list.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BUNDLED_CARDS,
  type ConsentToken,
  type DamagedPlugin,
  type Inspection,
  isDownloaded,
  type ModelCard,
  type ModelHost,
  needsDownload,
  type Operation,
  type PluginId,
  pluginIdOf,
  type PluginRegistryApi as PluginRegistry,
  type ScoreResult,
} from "@/lib/models";
import type { PageSpec } from "@/lib/page";
import { IdbPluginStore } from "@/lib/platform";

type ModelStatus = "checking" | "not-downloaded" | "downloading" | "ready" | "error";

/** An installed plugin, as the Models section and the lens bar show it. */
export interface InstalledView {
  readonly card: ModelCard;
  readonly publisherName: string;
  readonly fingerprint: string;
  /** The listed name, when the key is a known publisher's. */
  readonly knownName: string | null;
  /** The HTTPS URL it was installed from, or "" for a file. */
  readonly sourceUrl: string;
}

/** Whether this browser can run installed plugins: unknown until one is needed. */
type SandboxState = "unknown" | "checking" | "ok" | "unavailable";

export interface ModelsState {
  status: Record<string, ModelStatus>;
  progress: Record<string, { loaded: number; total: number }>;
  errors: Record<string, string>;
  installed: readonly InstalledView[];
  damaged: readonly DamagedPlugin[];
  sandbox: SandboxState;
  /** Download and load a plugin's model files. Only call after the author asks. */
  prepare: (id: PluginId) => Promise<void>;
  /** Score a page; a plugin that sends text off the device needs `consent`. */
  score: (id: PluginId, text: string, spec: PageSpec, consent?: ConsentToken) => Promise<ScoreResult>;
  /** Approve consent for one call with exactly this text: only the consent dialog calls it. */
  approve: (id: PluginId, operation: Operation, text: string) => Promise<ConsentToken>;
  inspectFile: (file: File) => Promise<Inspection>;
  inspectUrl: (url: string) => Promise<Inspection>;
  checkForUpdate: (id: string) => Promise<Inspection>;
  install: (inspection: Inspection) => Promise<void>;
  remove: (id: string) => Promise<void>;
  host: () => Promise<ModelHost>;
}

const viewOf = (registry: PluginRegistry): InstalledView[] =>
  registry.installed().map((p) => ({
    card: p.pkg.card,
    publisherName: p.pkg.publisher.name,
    fingerprint: p.pkg.publisher.fingerprint,
    knownName: p.known?.name ?? null,
    sourceUrl: p.sourceUrl,
  }));

export function useModels(): ModelsState {
  const [status, setStatus] = useState<Record<string, ModelStatus>>({});
  const [progress, setProgress] = useState<Record<string, { loaded: number; total: number }>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [installed, setInstalled] = useState<readonly InstalledView[]>([]);
  const [damaged, setDamaged] = useState<readonly DamagedPlugin[]>([]);
  const [sandbox, setSandbox] = useState<SandboxState>("unknown");
  const registryPromise = useRef<Promise<PluginRegistry> | null>(null);

  const registry = useCallback(() => {
    // The server render never needs models; this keeps the registry (and the
    // worker and model runtime behind it) out of the server bundle entirely.
    if (import.meta.env.SSR) return Promise.reject(new Error("Models run only in the browser."));
    registryPromise.current ??= import("@/lib/models/registry").then(async (m) => {
      const r = m.pluginRegistry();
      await r.load();
      return r;
    });
    return registryPromise.current;
  }, []);

  const host = useCallback(async () => (await registry()).host, [registry]);

  /** Check a plugin's download status: ready when nothing downloads or its files are stored. */
  const checkStatus = useCallback(
    async (card: ModelCard, downloaded: () => Promise<boolean>) => {
      if (!needsDownload(card)) {
        setStatus((s) => ({ ...s, [card.id]: "ready" }));
        return;
      }
      setStatus((s) => ({ ...s, [card.id]: "checking" }));
      try {
        // Start the plugin only if its model is already downloaded.
        const ready = (await downloaded()) && (await (await host()).status(pluginIdOf(card)));
        setStatus((s) => ({ ...s, [card.id]: ready ? "ready" : "not-downloaded" }));
      } catch (error) {
        setStatus((s) => ({ ...s, [card.id]: "error" }));
        setErrors((e) => ({ ...e, [card.id]: error instanceof Error ? error.message : String(error) }));
      }
    },
    [host],
  );

  /** Show the registry's installed plugins, and check the sandbox once there are any. */
  const refresh = useCallback(
    async (r: PluginRegistry) => {
      const views = viewOf(r);
      setInstalled(views);
      setDamaged([...r.damaged()]);
      for (const view of views) void checkStatus(view.card, async () => true);
      if (views.length > 0) {
        setSandbox((s) => (s === "unknown" ? "checking" : s));
        const works = await r.sandboxWorks();
        setSandbox(works ? "ok" : "unavailable");
      }
    },
    [checkStatus],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const card of BUNDLED_CARDS) {
        if (!needsDownload(card)) continue; // nothing to download, so nothing to check
        if (cancelled) return;
        await checkStatus(card, () => isDownloaded(pluginIdOf(card)));
      }
      // Installed plugins: load the registry only when this browser has some.
      try {
        if ((await new IdbPluginStore().records()).length === 0 || cancelled) return;
        const r = await registry();
        if (!cancelled) await refresh(r);
      } catch {
        // No IndexedDB here: nothing is installed.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [checkStatus, registry, refresh]);

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
    async (id: PluginId, text: string, spec: PageSpec, consent?: ConsentToken) =>
      (await host()).score(id, text, spec, undefined, consent),
    [host],
  );

  const approve = useCallback(
    async (id: PluginId, operation: Operation, text: string) =>
      (await host()).consent.request(id, operation, text).approve(),
    [host],
  );

  const inspectFile = useCallback(
    async (file: File) => (await registry()).inspect(new Uint8Array(await file.arrayBuffer())),
    [registry],
  );
  const inspectUrl = useCallback(async (url: string) => (await registry()).inspectUrl(url), [registry]);
  const checkForUpdate = useCallback(async (id: string) => (await registry()).checkForUpdate(id), [registry]);

  const install = useCallback(
    async (inspection: Inspection) => {
      const r = await registry();
      await r.install(inspection);
      await refresh(r);
    },
    [registry, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      const r = await registry();
      await r.remove(id);
      setStatus(({ [id]: _, ...rest }) => rest);
      await refresh(r);
    },
    [registry, refresh],
  );

  return {
    status,
    progress,
    errors,
    installed,
    damaged,
    sandbox,
    prepare,
    score,
    approve,
    inspectFile,
    inspectUrl,
    checkForUpdate,
    install,
    remove,
    host,
  };
}
