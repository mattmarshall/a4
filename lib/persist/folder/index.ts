/**
 * Folders on disk, as the UI uses them: the File System Access source the
 * browser workspace opens folders with, and the file list's types. The rest
 * (registry, access, scan, watch, the FolderFs port and its node:fs adapter
 * for tests) is the workspace's, which imports those modules directly.
 */

export type { ConnectedFolder, FolderState } from "./access.ts";
export { browserFolderSource } from "./fs-browser.ts";
export type { FolderFs, FolderSource } from "./fs.ts";
export { PAGE_ROWS, type FolderFile } from "./scan.ts";
