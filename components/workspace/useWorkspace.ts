"use client";

/**
 * React adapters for the workspace (lib/workspace/workspace.ts).
 *
 * - `useWorkspace()`: the tab's workspace and its snapshot, through
 *   `useSyncExternalStore`. While prerendering and before the first client
 *   render, the snapshot is the starting one.
 * - `useNotices()`: workspace notices as toasts, in English.
 * - `useWorkspaceApi()`: the commands the Workbench calls, with failures
 *   reported as toasts.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { PageName, PageRef, TrashId } from "@/lib/persist";
import {
  describeError,
  reportResult,
  type Notify,
  type Slot,
  type WorkspaceSnapshot,
  type Result,
} from "@/lib/workspace";
import { acquireWorkspace, releaseWorkspace, type BrowserWorkspace } from "./browser-workspace";
import { describeNotice } from "./notices";

const STARTING: WorkspaceSnapshot = {
  status: { kind: "starting" },
  storage: null,
  library: { pages: [], trash: [] },
  slots: {
    a: { ref: null, name: null, label: null, text: "", status: "saved", readOnly: false },
    b: { ref: null, name: null, label: null, text: "", status: "saved", readOnly: false },
  },
  folder: { state: { status: "none" }, files: [], letters: [], stacks: [], partial: false, scanning: false },
};

const noop = () => () => {};

function useWorkspace(): { workspace: BrowserWorkspace | null; snapshot: WorkspaceSnapshot } {
  const [workspace, setWorkspace] = useState<BrowserWorkspace | null>(null);
  useEffect(() => {
    const acquired = acquireWorkspace();
    setWorkspace(acquired);
    return () => releaseWorkspace(acquired);
  }, []);
  const snapshot = useSyncExternalStore(
    workspace?.subscribe ?? noop,
    workspace?.getSnapshot ?? (() => STARTING),
    () => STARTING,
  );
  return { workspace, snapshot };
}

/** Show workspace notices as toasts. */
function useNotices(workspace: BrowserWorkspace | null, notify: Notify): void {
  useEffect(() => {
    if (!workspace) return;
    return workspace.subscribeNotices((notice) => {
      const { message, tone } = describeNotice(notice);
      notify(message, tone);
    });
  }, [workspace, notify]);
}

/** Save when the tab is hidden or closing; check the folder when it comes back. */
function useTabLifecycle(workspace: BrowserWorkspace | null): void {
  useEffect(() => {
    if (!workspace) return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void workspace.hidden();
      else void workspace.visible();
    };
    const onPageHide = () => void workspace.hidden();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [workspace]);
}

function errorName(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined;
}

/** The workspace's state and commands for the Workbench, with failures reported through `notify`. */
export function useWorkspaceApi(notify: Notify) {
  const { workspace, snapshot } = useWorkspace();
  useNotices(workspace, notify);
  useTabLifecycle(workspace);
  const ws = workspace;

  const run = useCallback(
    <T>(what: string, command: (w: BrowserWorkspace) => Promise<Result<T>>) =>
      ws ? reportResult(command(ws), notify, what) : Promise.resolve(undefined),
    [ws, notify],
  );

  /** A command whose failure the caller shows inline: the message, or null on success. */
  const inline = useCallback(
    async <T>(command: (w: BrowserWorkspace) => Promise<Result<T>>) => {
      if (!ws) return "Storage isn’t ready yet.";
      const result = await command(ws);
      return result.ok ? null : describeError(result.error);
    },
    [ws],
  );

  /** Ask for a folder, and open it (replacing the open one). */
  const openFolder = useCallback(async () => {
    if (!ws) return;
    const picker = window.showDirectoryPicker;
    if (!picker) return;
    let handle: FileSystemDirectoryHandle;
    const asked = performance.now();
    try {
      handle = await picker({ mode: "readwrite", id: "a4-folder" });
    } catch (error) {
      if (errorName(error) === "AbortError") {
        // A cancel takes a person longer than this: the browser refused to show the picker.
        if (performance.now() - asked < 250) {
          notify("This browser didn’t show a folder picker. Open A4 in Chrome or Edge to edit a folder.", "warn");
        }
        return;
      }
      notify(`Couldn’t open that folder: ${describeError(error)} Try the repository folder itself.`, "warn");
      return;
    }
    const result = await ws.openFolder(handle);
    if (!result.ok) notify(`Couldn’t open that folder: ${describeError(result.error)}`, "warn");
  }, [ws, notify]);

  // Commands keep their identity while the workspace and `notify` do, so effects can depend on them.
  const commands = useMemo(
    () => ({
      retry: () => void ws?.start(),
      edit: (slot: Slot, text: string) => ws?.edit(slot, text),
      openInSlot: (slot: Slot, target: PageRef | PageName | null, what = "open the page") =>
        run(what, (w) => w.open(slot, target)),
      createPage: async (desired: string, text: string, slot: Slot = "a") =>
        (await run("create the page", (w) => w.createPage(desired, text, slot))) ?? null,
      renamePage: (from: PageName, input: string) => inline((w) => w.renamePage(from, input)),
      duplicatePage: (target: PageRef | PageName, what: string, slot?: Slot) =>
        run(what, (w) => w.duplicatePage(target, slot)),
      trashPage: (name: PageName) => run(`move “${name}” to the trash`, (w) => w.trashPage(name)),
      restorePage: (id: TrashId) => run("restore the page", (w) => w.restorePage(id)),
      purgePages: (ids: readonly TrashId[]) => run("delete the page permanently", (w) => w.purgePages(ids)),
      ensureSlotB: () => run("open page B", (w) => w.ensureSlotB()),
      closeSlotB: () => ws?.closeSlotB() ?? Promise.resolve(),
      swapSlots: () => run("swap the pages", (w) => w.swapSlots()),
      flushAll: () => ws?.flushAll() ?? Promise.resolve(false),
      exportAll: async () => {
        if (!ws) throw new Error("Storage isn’t ready yet.");
        const result = await ws.exportAll();
        if (!result.ok) throw result.error;
        return result.value;
      },
      importArchive: async (bytes: Uint8Array) => {
        if (!ws) throw new Error("Storage isn’t ready yet.");
        const result = await ws.importArchive(bytes);
        if (!result.ok) throw result.error;
        return result.value;
      },
      openFolder,
      reconnectFolder: () => run("reconnect the folder", (w) => w.reconnectFolder()),
      closeFolder: () => run("close the folder", (w) => w.closeFolder()),
      createFile: (input: string, text: string, slot: Slot) => inline((w) => w.createFile(input, text, slot)),
      saveToFolder: (name: PageName, input: string, slot: Slot) => inline((w) => w.saveToFolder(name, input, slot)),
      createLetter: (text: string, slot: Slot) => inline((w) => w.createLetter(text, slot)),
      sealLetter: (slot: Slot, seal: { verdict: "accepted" | "returned"; reason: string; signer: string }) =>
        inline((w) => w.sealLetter(slot, seal)),
    }),
    [ws, run, inline, openFolder],
  );

  const status = snapshot.status;
  return {
    ready: status.kind === "ready",
    failure: status.kind === "failed" ? describeError(status.error) : null,
    pages: snapshot.library.pages,
    trash: snapshot.library.trash,
    slots: snapshot.slots,
    storage: snapshot.storage,
    folder: snapshot.folder,
    ...commands,
  };
}
