"use client";

/**
 * The Pages panel: the library (search, open, rename, duplicate, trash), the
 * switch between this browser's library and a served one, the open folder's
 * files, export and import, and the trash. Pages and files are
 * both opened by reference; commands arrive grouped as `PageActions` and
 * `FolderActions`.
 */

import { type KeyboardEvent, useMemo, useRef, useState } from "react";
import {
  libraryRef,
  type PageName,
  type PageRef,
  type PageSummary,
  type TrashEntry,
  type TrashId,
} from "@/lib/persist";
import type { FolderSnapshot, Slot, StorageInfo, WorkspaceSnapshot } from "@/lib/workspace";
import { FolderSection, type FolderActions } from "./library/FolderSection";
import { libraryConfirm } from "./library-copy";
import { type LibraryActions, LibrarySwitch } from "./library/LibrarySwitch";
import { formatSize, type Placement, relativeTime, slotOf, otherSlot } from "./library/shared";
import styles from "./LibraryPanel.module.css";

export type { FolderActions } from "./library/FolderSection";
export type { LibraryActions } from "./library/LibrarySwitch";

/** Library commands. Rename returns an error message to show inline, or null. */
export interface PageActions {
  create(): void;
  rename(name: PageName, input: string): Promise<string | null>;
  /** Copy a page, or a folder file, into a new library page. */
  duplicate(ref: PageRef): void;
  trash(name: PageName): void;
  restore(id: TrashId): void;
  purge(ids: readonly TrashId[]): void;
  exportAll(): void;
  importArchive(file: File): void;
}

/** Folder commands. Creating and saving return an error message to show inline, or null. */
function RenameField({
  initial,
  onDone,
  onCancel,
}: {
  initial: string;
  onDone: (value: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  async function commit(next: string) {
    const message = await onDone(next);
    if (message) setError(message);
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") void commit(e.currentTarget.value);
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }
  return (
    <div className={styles.rename}>
      <input
        // biome-ignore lint/a11y/noAutofocus: the field appears when the user asks to rename.
        autoFocus
        className={styles.input}
        aria-label="New page name"
        value={value}
        maxLength={80}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        onKeyDown={onKey}
        onBlur={(e) => (e.currentTarget.value === initial ? onCancel() : void commit(e.currentTarget.value))}
      />
      {error ? <span className={styles.error}>{error}</span> : null}
    </div>
  );
}

/** Whether the browser keeps the pages, when it can say. */
function persistenceNote(persistent: boolean | null): string {
  if (persistent === null) return "";
  return persistent ? " · persistent" : " · best-effort: the browser may clear it under storage pressure";
}

/** Where pages are kept, for the panel's footer. */
function storageNote(storage: StorageInfo | null, served: WorkspaceSnapshot["served"]): string {
  if (!storage) return "Opening storage…";
  switch (storage.kind) {
    case "served":
      return `Saved as .md files by a4 serve at ${served?.address ?? "this machine"} (pages/ in its folder). They don’t sync with this browser’s pages.`;
    case "opfs":
      return `Saved as .md files in this browser’s private file system (a4/pages)${persistenceNote(storage.persistent)}`;
    case "local-storage":
      return "Saved in this browser’s local storage (file system storage is unavailable here)";
    default:
      return "Not saved: this browser blocks storage, so pages are lost on reload";
  }
}

export function LibraryPanel({
  pages,
  trash,
  storage,
  served,
  folder,
  open,
  compare,
  activeSlot,
  saveRequest,
  onOpen,
  pageActions,
  libraryActions,
  folderActions,
}: {
  pages: readonly PageSummary[];
  trash: readonly TrashEntry[];
  storage: StorageInfo | null;
  /** The served library this browser connects to, if any. */
  served: WorkspaceSnapshot["served"];
  folder: FolderSnapshot;
  /** What each shown slot holds (B is null in Single). */
  open: Readonly<Record<Slot, PageRef | null>>;
  compare: boolean;
  /** The slot a plain click opens into. */
  activeSlot: Slot;
  /** "Save to folder…" was chosen for this library page. */
  saveRequest: { readonly name: string } | null;
  onOpen: (ref: PageRef, slot: Slot) => void;
  pageActions: PageActions;
  libraryActions: LibraryActions;
  folderActions: FolderActions;
}) {
  const placement: Placement = { open, compare, activeSlot };
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<PageName | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const now = Date.now();

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("en-US");
    return q ? pages.filter((p) => p.name.toLocaleLowerCase("en-US").includes(q)) : pages;
  }, [pages, query]);

  return (
    <aside className="library" aria-label="Page library" data-print="hide">
      <div className={styles.head}>
        <h2 className={`${styles.title} eyebrow`}>
          Pages <span className={styles.count}>{pages.length}</span>
        </h2>
        <button type="button" className="btn btn-outline" onClick={pageActions.create}>
          + New page
        </button>
      </div>

      <LibrarySwitch served={served} actions={libraryActions} />

      <input
        className={styles.input}
        type="search"
        placeholder="Search pages"
        aria-label="Search pages"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <ul className={styles.list}>
        {visible.map((p) => {
          const ref = libraryRef(p.name);
          const slot = slotOf(placement, ref);
          return (
            <li key={p.name} className={styles.item} data-open={slot ?? undefined}>
              {renaming === p.name ? (
                <RenameField
                  initial={p.name}
                  onCancel={() => setRenaming(null)}
                  onDone={async (value) => {
                    const error = await pageActions.rename(p.name, value);
                    if (!error) setRenaming(null);
                    return error;
                  }}
                />
              ) : (
                <button
                  type="button"
                  className={styles.open}
                  onClick={() => onOpen(ref, compare ? activeSlot : "a")}
                  title={compare ? `Open in ${activeSlot.toUpperCase()}` : "Open"}
                >
                  <span className={styles.name}>{p.name}</span>
                  <span className={styles.meta}>
                    {relativeTime(p.modifiedAt, now)} · {formatSize(p.size)}
                  </span>
                  {slot ? <span className={styles.badge}>{compare ? slot.toUpperCase() : "open"}</span> : null}
                </button>
              )}
              {renaming !== p.name ? (
                <div className={styles.actions}>
                  {compare ? (
                    <button type="button" onClick={() => onOpen(ref, otherSlot(activeSlot))}>
                      Open in {otherSlot(activeSlot).toUpperCase()}
                    </button>
                  ) : null}
                  <button type="button" onClick={() => setRenaming(p.name)}>
                    Rename
                  </button>
                  <button type="button" onClick={() => pageActions.duplicate(ref)}>
                    Duplicate
                  </button>
                  <button type="button" onClick={() => pageActions.trash(p.name)}>
                    Delete
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
        {visible.length === 0 ? <li className={styles.empty}>{query ? "No pages match." : "No pages yet."}</li> : null}
      </ul>

      <FolderSection
        folder={folder}
        query={query}
        placement={placement}
        saveRequest={saveRequest}
        onOpen={onOpen}
        onDuplicate={pageActions.duplicate}
        actions={folderActions}
      />

      <div className={styles.transfer}>
        <button
          type="button"
          className="btn btn-outline"
          onClick={pageActions.exportAll}
          disabled={pages.length === 0}
          title="Download every page as .md files in one .zip"
        >
          ⇩ Export all ({pages.length}) as .zip
        </button>
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => fileInput.current?.click()}
          title="Add the .md and .txt files in a .zip as pages. Existing pages are never changed."
        >
          ⇧ Import .zip
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) pageActions.importArchive(file);
          }}
        />
      </div>

      <div className={styles.trash}>
        <button
          type="button"
          className={styles.trashToggle}
          aria-expanded={showTrash}
          onClick={() => setShowTrash((s) => !s)}
        >
          {showTrash ? "▾" : "▸"} Trash ({trash.length})
        </button>
        {showTrash ? (
          <>
            <ul className={styles.list}>
              {trash.map((t) => (
                <li key={t.id} className={`${styles.item} ${styles.trashed}`}>
                  <div className={styles.open} aria-disabled="true">
                    <span className={styles.name}>{t.name}</span>
                    <span className={styles.meta}>
                      deleted {relativeTime(t.trashedAt, now)} · {formatSize(t.size)}
                    </span>
                  </div>
                  <div className={`${styles.actions} ${styles.actionsVisible}`}>
                    <button type="button" onClick={() => pageActions.restore(t.id)}>
                      Restore
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(libraryConfirm.purgePage(t.name))) pageActions.purge([t.id]);
                      }}
                    >
                      Delete forever
                    </button>
                  </div>
                </li>
              ))}
              {trash.length === 0 ? <li className={styles.empty}>Trash is empty.</li> : null}
            </ul>
            {trash.length > 0 ? (
              <button
                type="button"
                className={`btn btn-outline ${styles.emptyTrash}`}
                onClick={() => {
                  if (window.confirm(libraryConfirm.emptyTrash(trash.length))) {
                    pageActions.purge(trash.map((t) => t.id));
                  }
                }}
              >
                Empty trash
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      <footer className={styles.foot}>{storageNote(storage, served)}</footer>
    </aside>
  );
}
