"use client";

/**
 * The Pages panel: the library (search, open, rename, duplicate, trash), the
 * open folder's files, export and import, and the trash. Pages and files are
 * both opened by reference; commands arrive grouped as `PageActions` and
 * `FolderActions`.
 */

import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  type FolderFile,
  MAX_FILE_BYTES,
  PAGE_ROWS,
  SCAN_ENTRY_LIMIT,
  fileRef,
  libraryRef,
  sameRef,
  type PageName,
  type PageRef,
  type PageSummary,
  type TrashEntry,
  type TrashId,
} from "@/lib/persist";
import { SLOTS, type FolderSnapshot, type Slot, type StorageInfo } from "@/lib/workspace";
import { ENGLISH, formatByteLimit } from "./analysis-copy";
import styles from "./LibraryPanel.module.css";

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
export interface FolderActions {
  /** Pick a folder and open it. */
  pick(): void;
  reconnect(): void;
  /** Save open files, close the folder, and forget it. */
  close(): void;
  createFile(path: string): Promise<string | null>;
  /** Write the page "Save to folder…" was chosen for to `path`. */
  saveTo(path: string): Promise<string | null>;
  cancelSave(): void;
}

/** Where a page shows in the panel's badges and "Open in" buttons. */
interface Placement {
  /** What each shown slot holds (B is null in Single). */
  readonly open: Readonly<Record<Slot, PageRef | null>>;
  readonly compare: boolean;
  readonly activeSlot: Slot;
}

/** The shown slot holding `ref`, if any. */
function slotOf(placement: Placement, ref: PageRef): Slot | null {
  return SLOTS.find((slot) => sameRef(placement.open[slot], ref)) ?? null;
}

const otherSlot = (slot: Slot): Slot => (slot === "a" ? "b" : "a");

export function relativeTime(ms: number, now: number = Date.now()): string {
  const s = Math.round((now - ms) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

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

export function LibraryPanel({
  pages,
  trash,
  storage,
  folder,
  open,
  compare,
  activeSlot,
  saveRequest,
  onOpen,
  pageActions,
  folderActions,
}: {
  pages: readonly PageSummary[];
  trash: readonly TrashEntry[];
  storage: StorageInfo | null;
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
                        if (window.confirm(`Permanently delete “${t.name}”? This can’t be undone.`))
                          pageActions.purge([t.id]);
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
                  if (
                    window.confirm(`Permanently delete ${trash.length} page(s) in the trash? This can’t be undone.`)
                  ) {
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

      <footer className={styles.foot}>
        {storage ? (
          storage.kind === "opfs" ? (
            <>
              Saved as .md files in this browser’s private file system (a4/pages)
              {storage.persistent === true
                ? " · persistent"
                : storage.persistent === false
                  ? " · best-effort: the browser may clear it under storage pressure"
                  : ""}
            </>
          ) : storage.kind === "local-storage" ? (
            "Saved in this browser’s local storage (file system storage is unavailable here)"
          ) : (
            "Not saved: this browser blocks storage, so pages are lost on reload"
          )
        ) : (
          "Opening storage…"
        )}
      </footer>
    </aside>
  );
}

const REASON: Record<NonNullable<FolderFile["unreadable"]>, string> = {
  "too-large": `too large to open (over ${formatByteLimit(MAX_FILE_BYTES)})`,
  "not-utf8": "not UTF-8 text",
};

/** A path field for creating a file in the folder. */
function PathForm({
  label,
  initial,
  submit,
  onSubmit,
  onCancel,
}: {
  label: string;
  initial: string;
  submit: string;
  onSubmit: (path: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const message = await onSubmit(value);
    setBusy(false);
    if (message) setError(message);
  }
  return (
    <form className={styles.pathForm} onSubmit={(e) => void send(e)}>
      <label className={styles.pathLabel}>
        {label}
        <input
          // biome-ignore lint/a11y/noAutofocus: the form appears when the user asks to save or create a file.
          autoFocus
          className={styles.input}
          value={value}
          placeholder="AGENTS.md"
          spellCheck={false}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
        />
      </label>
      {error ? <span className={styles.error}>{error}</span> : null}
      <div className={styles.pathActions}>
        <button type="submit" className="btn btn-outline" disabled={busy || !value.trim()}>
          {submit}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function FileRow({
  file,
  placement,
  onOpen,
  onDuplicate,
}: {
  file: FolderFile;
  placement: Placement;
  onOpen: (ref: PageRef, slot: Slot) => void;
  onDuplicate: (ref: PageRef) => void;
}) {
  const { compare, activeSlot } = placement;
  const ref = fileRef(file.path);
  const slot = slotOf(placement, ref);
  const over = file.rows !== null && file.rows > PAGE_ROWS ? file.rows - PAGE_ROWS : 0;
  if (file.unreadable) {
    return (
      <li className={`${styles.item} ${styles.file}`} data-unreadable="">
        <div className={styles.open} aria-disabled="true" title={`Can’t open: ${REASON[file.unreadable]}`}>
          <span className={`${styles.name} ${styles.path}`}>{file.path}</span>
          <span className={styles.meta}>{REASON[file.unreadable]}</span>
        </div>
      </li>
    );
  }
  return (
    <li className={`${styles.item} ${styles.file}`} data-open={slot ?? undefined}>
      <button
        type="button"
        className={styles.open}
        onClick={() => onOpen(ref, compare ? activeSlot : "a")}
        title={compare ? `Open in ${activeSlot.toUpperCase()}` : "Open"}
      >
        <span className={`${styles.name} ${styles.path}`}>{file.path}</span>
        <span className={styles.meta}>
          {relativeTime(file.modifiedAt)} · {formatSize(file.size)}
          {file.rows !== null ? (
            <>
              {" · "}
              <span className={styles.rows} data-over={over ? "" : undefined}>
                {file.rows} of {PAGE_ROWS} rows{over ? `, ${over} over` : ""}
              </span>
            </>
          ) : null}
        </span>
        {slot ? <span className={styles.badge}>{compare ? slot.toUpperCase() : "open"}</span> : null}
      </button>
      <div className={styles.actions}>
        {compare ? (
          <button type="button" onClick={() => onOpen(ref, otherSlot(activeSlot))}>
            Open in {otherSlot(activeSlot).toUpperCase()}
          </button>
        ) : null}
        <button type="button" onClick={() => onDuplicate(ref)} title="Copy into a new library page">
          Duplicate to library
        </button>
      </div>
    </li>
  );
}

function FolderSection({
  folder,
  query,
  placement,
  saveRequest,
  onOpen,
  onDuplicate,
  actions,
}: {
  folder: FolderSnapshot;
  query: string;
  placement: Placement;
  saveRequest: { readonly name: string } | null;
  onOpen: (ref: PageRef, slot: Slot) => void;
  onDuplicate: (ref: PageRef) => void;
  actions: FolderActions;
}) {
  const [creating, setCreating] = useState(false);
  const [showOther, setShowOther] = useState(false);
  const { state } = folder;

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("en-US");
    return q ? folder.files.filter((f) => f.path.toLocaleLowerCase("en-US").includes(q)) : folder.files;
  }, [folder.files, query]);
  const context = visible.filter((f) => f.group === "context");
  const other = visible.filter((f) => f.group === "other");
  const row = (f: FolderFile) => (
    <FileRow key={f.path} file={f} placement={placement} onOpen={onOpen} onDuplicate={onDuplicate} />
  );

  if (state.status === "unsupported") {
    return (
      <section className={styles.folder} aria-label="Folder">
        <p className={styles.note}>Opening a folder needs Chrome or Edge. Your pages here work as before.</p>
      </section>
    );
  }

  if (state.status === "none") {
    return (
      <section className={styles.folder} aria-label="Folder">
        <button type="button" className={`btn btn-outline ${styles.folderOpen}`} onClick={actions.pick}>
          Open folder…
        </button>
        <p className={styles.note}>
          Edit a repository’s AGENTS.md, CLAUDE.md, and skill files in place. Files stay on this device.
        </p>
      </section>
    );
  }

  if (state.status === "connecting") {
    return (
      <section className={styles.folder} aria-label="Folder">
        <p className={styles.note}>Connecting to “{state.name ?? "the folder"}”…</p>
      </section>
    );
  }

  if (state.status === "reconnect") {
    return (
      <section className={styles.folder} aria-label={`Folder ${state.name}`}>
        <div className={styles.head}>
          <h2 className={styles.folderName}>{state.name}</h2>
        </div>
        <p className={styles.note}>The browser needs your permission again for A4 to edit this folder.</p>
        <div className={styles.pathActions}>
          <button type="button" className="btn btn-outline" onClick={actions.reconnect}>
            Reconnect
          </button>
          <button type="button" className="btn" onClick={actions.close}>
            Forget
          </button>
        </div>
      </section>
    );
  }

  if (state.status === "not-found") {
    return (
      <section className={styles.folder} aria-label="Folder not found">
        <p className={styles.note}>
          <strong>Folder not found.</strong>{" "}
          {state.name ? `“${state.name}” was moved or deleted.` : "The remembered folder is gone."}
        </p>
        <div className={styles.pathActions}>
          <button type="button" className="btn btn-outline" onClick={actions.pick}>
            Open folder…
          </button>
          <button type="button" className="btn" onClick={actions.close}>
            Forget
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.folder} aria-label={`Folder ${state.name}`}>
      <div className={styles.head}>
        <h2 className={styles.folderName} title={state.name}>
          {state.name} <span className={styles.count}>{folder.files.length}</span>
        </h2>
        <span className={styles.folderTools}>
          <button type="button" className="btn" onClick={() => setCreating((c) => !c)} aria-expanded={creating}>
            + New file
          </button>
          <button
            type="button"
            className="btn"
            onClick={actions.close}
            title="Save open files and close the folder. Open it again with Open folder…"
          >
            Close
          </button>
        </span>
      </div>

      {saveRequest ? (
        <PathForm
          key={`save:${saveRequest.name}`}
          label={`Save “${saveRequest.name}” to ${state.name} as`}
          initial={`${saveRequest.name}.md`}
          submit="Save to folder"
          onSubmit={actions.saveTo}
          onCancel={actions.cancelSave}
        />
      ) : creating ? (
        <PathForm
          label={`New file in ${state.name}`}
          initial="AGENTS.md"
          submit="Create"
          onSubmit={async (path) => {
            const error = await actions.createFile(path);
            if (!error) setCreating(false);
            return error;
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}

      {folder.scanning && folder.files.length === 0 ? <p className={styles.note}>Scanning…</p> : null}
      {folder.partial ? (
        <p className={styles.note}>
          The folder is very large: the list stops after {ENGLISH.count(SCAN_ENTRY_LIMIT)} entries.
        </p>
      ) : null}

      <h3 className={`${styles.group} eyebrow`}>Context files</h3>
      <ul className={styles.list}>
        {context.map(row)}
        {context.length === 0 && !folder.scanning ? (
          <li className={styles.empty}>{query ? "No context files match." : "No context files found."}</li>
        ) : null}
      </ul>

      {other.length > 0 ? (
        <>
          <button
            type="button"
            className={styles.trashToggle}
            aria-expanded={showOther}
            onClick={() => setShowOther((v) => !v)}
          >
            {showOther ? "▾" : "▸"} Other Markdown ({other.length})
          </button>
          {showOther ? <ul className={styles.list}>{other.map(row)}</ul> : null}
        </>
      ) : null}
    </section>
  );
}
