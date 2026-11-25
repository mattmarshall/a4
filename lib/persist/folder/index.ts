/**
 * Folders on disk, as the UI uses them: the File System Access source the
 * browser workspace opens folders with, and the file list's types. The rest
 * (registry, access, scan, watch, the FolderFs port and its node:fs adapter
 * for tests) is the workspace's, which imports those modules directly.
 */

export { browserFolderSource } from "./fs-browser.ts";
export type { FolderFs } from "./fs.ts";
export type { FolderFile } from "./scan.ts";
