/**
 * The workspace this tab uses: one at a time, with the browser's ports.
 * React StrictMode mounts, unmounts, and mounts again at once; dispose waits a
 * tick, so that remount keeps the same workspace. Leaving the page (to /why)
 * disposes it, which saves every open page.
 */

import { browserFolderSource } from "@/lib/persist";
import { browserPlatform } from "@/lib/platform";
import { INCIDENT_JSON, INCIDENT_NARRATIVE, TEMPLATES, WELCOME } from "@/lib/content";
import { Workspace } from "@/lib/workspace";

export type BrowserWorkspace = Workspace<FileSystemDirectoryHandle>;

const SKIP_MIGRATION = [WELCOME, INCIDENT_JSON, INCIDENT_NARRATIVE, ...TEMPLATES.map((t) => t.text)];

let current: BrowserWorkspace | null = null;
let users = 0;

function create(): BrowserWorkspace {
  const platform = browserPlatform();
  return new Workspace({
    platform,
    folders: { source: browserFolderSource, handles: platform.handles },
    welcomeText: WELCOME,
    skipMigration: SKIP_MIGRATION,
    isVisible: () => document.visibilityState === "visible",
  });
}

/** Take the tab's workspace (creating and starting it if needed). */
export function acquireWorkspace(): BrowserWorkspace {
  users++;
  if (!current) {
    current = create();
    void current.start();
  }
  return current;
}

/** Give it back; the last user's release disposes it (after a tick). */
export function releaseWorkspace(workspace: BrowserWorkspace): void {
  users--;
  setTimeout(() => {
    if (users > 0 || current !== workspace) return;
    current = null;
    void workspace.dispose();
  }, 0);
}
