/**
 * The library's page and folder commands in English: what each was doing
 * when it failed, for its notice ("Couldn’t move “Brief” to the trash: …"),
 * and the folder picker's notices. The reason is the error's own sentence,
 * written once in `lib/`.
 *
 * Relative imports, so Node's test runner can load this file.
 */

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
