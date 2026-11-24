/**
 * The workspace: the tab's library, its two slots, and the open folder,
 * behind one controller with a snapshot, notices, and commands that return a
 * Result. Depends on lib/persist, lib/archive, lib/page, and lib/platform.
 */

export { describeError, reportResult, type Notify } from "./errors.ts";
export {
  SLOTS,
  type FolderSnapshot,
  type Result,
  type Slot,
  type SlotSnapshot,
  type StorageInfo,
  type WorkspaceNotice,
  type WorkspaceSnapshot,
  type WorkspaceStatus,
} from "./types.ts";
export { Workspace, type WorkspaceOptions } from "./workspace.ts";
