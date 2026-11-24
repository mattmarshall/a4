// The File System Access picker A4 uses to open a folder. TypeScript's DOM
// types don't include it yet, and only some browsers have it, so it's optional.

export {};

declare global {
  interface DirectoryPickerOptions {
    mode?: "read" | "readwrite";
    id?: string;
  }

  interface Window {
    showDirectoryPicker?: (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>;
  }
}
