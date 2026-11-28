/**
 * The library's pages and folders in English:
 * - what each command was doing when it failed, for its notice ("Couldn’t
 *   move “Brief” to the trash: …"), whose reason is the error's own
 *   sentence, written once in `lib/`;
 * - what a command did (created, copied, exported), and saving;
 * - the confirmations before text is cleared or deleted;
 * - the folder picker's notices.
 *
 * Relative imports, so Node's test runner can load this file.
 */

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What a failed page or folder command was doing, for its notice: "Couldn’t <action>: <why>". */
export const libraryActions = {
  /** Opening a page with no name to give, such as a pen's source. */
  openPage: "open the page",
  openNamed: (label: string) => `open “${label}”`,
  createPage: "create the page",
  duplicate: (name: string) => `duplicate “${name}”`,
  copyIntoLibrary: (path: string) => `copy “${path}” into the library`,
  copyAToB: "copy page A into B",
  trashPage: (name: string) => `move “${name}” to the trash`,
  restorePage: "restore the page",
  purgePages: "delete the page permanently",
  openPageB: "open page B",
  swapPages: "swap the pages",
  reconnectFolder: "reconnect the folder",
  closeFolder: "close the folder",
  exportPages: "export the pages",
  importFile: (name: string) => `import “${name}”`,
} as const;

/** What a page or library command did, and saving. */
export const libraryNotices = {
  saved: "Saved",
  saveFailed: "Saving failed. A4 keeps your edits and will keep trying.",
  created: (name: string) => `Created “${name}”.`,
  copiedIntoLibrary: (path: string, name: string) => `Copied “${path}” into the library as “${name}”.`,
  /** The page's text, copied to the clipboard. */
  copiedText: (label: string | null, characters: number) =>
    `Copied “${label}” (${characters.toLocaleString("en-US")} characters)`,
  exported: (count: number, fileName: string) => `Exported ${plural(count, "page")} to ${fileName}`,
  /** Refused before it's read, so the reason isn't an error's. */
  importTooLarge: (name: string, limit: string) => `Couldn’t import “${name}”: files over ${limit} aren’t supported.`,
} as const;

/** The confirmations before text is cleared or deleted. */
export const libraryConfirm = {
  clearPage: (label: string) => `Clear all text on “${label}”?`,
  trashPage: (name: string) => `Move “${name}” to the trash? You can restore it from the trash.`,
  purgePage: (name: string) => `Permanently delete “${name}”? This can’t be undone.`,
  emptyTrash: (count: number) => `Permanently delete ${plural(count, "page")} in the trash? This can’t be undone.`,
} as const;

/** The folder picker's notices. `why` is the error's own sentence. */
export const folderPicker = {
  /** The browser refused to show a picker, too fast for a person to cancel it. */
  notShown: "This browser didn’t show a folder picker. Open A4 in Chrome or Edge to edit a folder.",
  /** The picker failed: the author may have picked a folder the browser won't allow. */
  pickFailed: (why: string) => `Couldn’t open that folder: ${why} Try the repository folder itself.`,
  /** A4 couldn't open the folder that was picked. */
  openFailed: (why: string) => `Couldn’t open that folder: ${why}`,
} as const;
