"use client";

/**
 * Model host state for the workbench: each plugin's status and download
 * progress, the author's installed plugins, and calls into the host. The host
 * (and each plugin's code) loads lazily; listing bundled cards loads nothing,
 * and the registry loads at start only when this browser has installed
 * plugins to list.
 *
 * The installed plugins are refreshed whenever the registry says they
 * changed, in this tab or another. A tab that hasn't loaded the registry
 * listens on PLUGIN_CHANNEL instead, and loads it when another tab installs a
 * plugin (design: harden-pens-and-plugins, decision 5).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BUNDLED_CARDS,
  type ConsentToken,
  type DamagedPlugin,
  ErrorCode,
  type Inspection,
  isDownloaded,
  isModelError,
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
import { browserChannel, IdbPluginStore, PLUGIN_CHANNEL } from "@/lib/platform";

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
  status: ReadonlyMap<PluginId, ModelStatus>;
  progress: ReadonlyMap<PluginId, { loaded: number; total: number }>;
  errors: ReadonlyMap<PluginId, string>;
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
  checkForUpdate: (id: PluginId) => Promise<Inspection>;
  install: (inspection: Inspection) => Promise<void>;
  remove: (id: PluginId) => Promise<void>;
  /** Remove a stored plugin that failed its checks, by the id it's stored under. */
  removeDamaged: (id: string) => Promise<void>;
  host: () => Promise<ModelHost>;
}

/** `map` with `id` set to `value`. */
function withEntry<V>(map: ReadonlyMap<PluginId, V>, id: PluginId, value: V): ReadonlyMap<PluginId, V> {
  return new Map(map).set(id, value);
}

/** `map` without `id`. */
function without<V>(map: ReadonlyMap<PluginId, V>, id: PluginId): ReadonlyMap<PluginId, V> {
  if (!map.has(id)) return map;
  const next = new Map(map);
  next.delete(id);
  return next;
}

/** `map` with only the ids in `keep`. */
function onlyKeys<V>(map: ReadonlyMap<PluginId, V>, keep: ReadonlySet<PluginId>): ReadonlyMap<PluginId, V> {
  return [...map.keys()].every((id) => keep.has(id)) ? map : new Map([...map].filter(([id]) => keep.has(id)));
}

const BUNDLED_IDS: readonly PluginId[] = BUNDLED_CARDS.map(pluginIdOf);

const viewOf = (registry: PluginRegistry): InstalledView[] =>
  registry.installed().map((p) => ({
    card: p.pkg.card,
    publisherName: p.pkg.publisher.name,
    fingerprint: p.pkg.publisher.fingerprint,
    knownName: p.known?.name ?? null,
    sourceUrl: p.sourceUrl,
  }));

export function useModels(): ModelsState {
  const [status, setStatus] = useState<ReadonlyMap<PluginId, ModelStatus>>(new Map());
  const [progress, setProgress] = useState<ReadonlyMap<PluginId, { loaded: number; total: number }>>(new Map());
  const [errors, setErrors] = useState<ReadonlyMap<PluginId, string>>(new Map());
  const [installed, setInstalled] = useState<readonly InstalledView[]>([]);
  const [damaged, setDamaged] = useState<readonly DamagedPlugin[]>([]);
  const [sandbox, setSandbox] = useState<SandboxState>("unknown");
  /** The registry, once it has loaded. */
  const [loaded, setLoaded] = useState<PluginRegistry | null>(null);
  const registryPromise = useRef<Promise<PluginRegistry> | null>(null);

  const registry = useCallback(() => {
    // The server render never needs models; this keeps the registry (and the
    // worker and model runtime behind it) out of the server bundle entirely.
    if (import.meta.env.SSR) return Promise.reject(new Error("Models run only in the browser."));
    registryPromise.current ??= import("@/lib/models/registry").then(async (m) => {
      const r = m.pluginRegistry();
      await r.load();
      setLoaded(r);
      return r;
    });
    return registryPromise.current;
  }, []);

  const host = useCallback(async () => (await registry()).host, [registry]);

  /** Check a plugin's download status: ready when nothing downloads or its files are stored. */
  const checkStatus = useCallback(
    async (card: ModelCard, downloaded: () => Promise<boolean>) => {
      const id = pluginIdOf(card);
      if (!needsDownload(card)) {
        setStatus((s) => withEntry(s, id, "ready"));
        return;
      }
      setStatus((s) => withEntry(s, id, "checking"));
      try {
        // Start the plugin only if its model is already downloaded.
        const ready = (await downloaded()) && (await (await host()).status(id));
        setStatus((s) => withEntry(s, id, ready ? "ready" : "not-downloaded"));
        setErrors((e) => without(e, id));
      } catch (error) {
        setStatus((s) => withEntry(s, id, "error"));
        setErrors((e) => withEntry(e, id, error instanceof Error ? error.message : String(error)));
      }
    },
    [host],
  );

  /** Each installed plugin's card as last checked: the registry keeps a card until it registers a new version. */
  const checkedCards = useRef(new Map<PluginId, ModelCard>());

  /**
   * Show the registry's installed plugins, drop what's known about removed
   * ones, and check the sandbox once there are any. Only a plugin that's new
   * or a new version is checked again, so another plugin's change doesn't
   * interrupt this one's download or turn its lens off.
   */
  const refresh = useCallback(
    async (r: PluginRegistry) => {
      const views = viewOf(r);
      const keep = new Set([...BUNDLED_IDS, ...views.map((v) => pluginIdOf(v.card))]);
      setInstalled(views);
      setDamaged([...r.damaged()]);
      setStatus((s) => onlyKeys(s, keep));
      setProgress((p) => onlyKeys(p, keep));
      setErrors((e) => onlyKeys(e, keep));
      const checked = checkedCards.current;
      for (const id of [...checked.keys()]) if (!keep.has(id)) checked.delete(id);
      for (const view of views) {
        const id = pluginIdOf(view.card);
        if (checked.get(id) === view.card) continue;
        checked.set(id, view.card);
        void checkStatus(view.card, async () => true);
      }
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
        await registry();
      } catch {
        // No IndexedDB here: nothing is installed.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [checkStatus, registry]);

  // Once the registry has loaded: show its plugins, and again each time they
  // change, in this tab or another.
  useEffect(() => {
    if (!loaded) return;
    void refresh(loaded);
    return loaded.subscribe(() => void refresh(loaded));
  }, [loaded, refresh]);

  // Until then, another tab's install wakes this one: the registry loads, and
  // reads the store as it is now. Its own subscription takes over from there.
  useEffect(() => {
    if (loaded) return;
    const channel = browserChannel(PLUGIN_CHANNEL);
    if (!channel) return;
    channel.subscribe(() => void registry().catch(() => {}));
    return () => channel.close();
  }, [loaded, registry]);

  const prepare = useCallback(
    async (id: PluginId) => {
      setStatus((s) => withEntry(s, id, "downloading"));
      setErrors((e) => without(e, id));
      try {
        await (await host()).prepare(id, (done, total) =>
          setProgress((p) => withEntry(p, id, { loaded: done, total })),
        );
        setStatus((s) => withEntry(s, id, "ready"));
      } catch (error) {
        setStatus((s) => withEntry(s, id, "not-downloaded"));
        setErrors((e) => withEntry(e, id, error instanceof Error ? error.message : String(error)));
      }
    },
    [host],
  );

  /**
   * Score a page. A plugin whose model files are missing or changed since this
   * tab checked them fails as not ready; its status is checked again, so its
   * lens turns off and its card offers the download again.
   */
  const score = useCallback(
    async (id: PluginId, text: string, spec: PageSpec, consent?: ConsentToken) => {
      try {
        return await (await host()).score(id, text, spec, undefined, consent);
      } catch (error) {
        if (isModelError(error, ErrorCode.NOT_READY)) {
          const bundled = BUNDLED_CARDS.find((card) => pluginIdOf(card) === id);
          const installedCard = checkedCards.current.get(id);
          if (bundled) void checkStatus(bundled, () => isDownloaded(id));
          else if (installedCard) void checkStatus(installedCard, async () => true);
        }
        throw error;
      }
    },
    [host, checkStatus],
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
  const checkForUpdate = useCallback(async (id: PluginId) => (await registry()).checkForUpdate(id), [registry]);

  // The registry tells its subscribers after each of these, so the list refreshes from there.
  const install = useCallback(
    async (inspection: Inspection) => {
      await (await registry()).install(inspection);
    },
    [registry],
  );
  const remove = useCallback(async (id: PluginId) => (await registry()).remove(id), [registry]);
  const removeDamaged = useCallback(async (id: string) => (await registry()).removeDamaged(id), [registry]);

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
    removeDamaged,
    host,
  };
}
