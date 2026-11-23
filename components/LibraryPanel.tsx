"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import type { PageName, PageSummary, TrashEntry, TrashId } from "@/lib/store";
import type { Slot, StorageInfo } from "./useLibrary";

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
    if (e.key === "Escape") onCancel();
  }
  return (
    <div className="lib-rename">
      <input
        autoFocus
        className="lib-input"
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
      {error ? <span className="lib-error">{error}</span> : null}
    </div>
  );
}

export function LibraryPanel({
  pages,
  trash,
  open,
  compare,
  activeSlot,
  storage,
  onOpen,
  onNew,
  onRename,
  onDuplicate,
  onTrash,
  onRestore,
  onPurge,
}: {
  pages: PageSummary[];
  trash: TrashEntry[];
  open: Record<Slot, PageName | null>;
  compare: boolean;
  activeSlot: Slot;
  storage: StorageInfo | null;
  onOpen: (name: PageName, slot: Slot) => void;
  onNew: () => void;
  onRename: (name: PageName, input: string) => Promise<string | null>;
  onDuplicate: (name: PageName) => void;
  onTrash: (name: PageName) => void;
  onRestore: (id: TrashId) => void;
  onPurge: (ids: TrashId[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<PageName | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const now = Date.now();

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("en-US");
    return q ? pages.filter((p) => p.name.toLocaleLowerCase("en-US").includes(q)) : pages;
  }, [pages, query]);

  return (
    <aside className="library" aria-label="Page library">
      <div className="lib-head">
        <h2>
          Pages <span className="lib-count">{pages.length}</span>
        </h2>
        <button type="button" className="btn btn-outline" onClick={onNew}>
          + New page
        </button>
      </div>

      <input
        className="lib-input lib-search"
        type="search"
        placeholder="Search pages"
        aria-label="Search pages"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <ul className="lib-list">
        {visible.map((p) => {
          const slot: Slot | null = open.a === p.name ? "a" : open.b === p.name ? "b" : null;
          return (
            <li key={p.name} className="lib-item" data-open={slot ?? undefined}>
              {renaming === p.name ? (
                <RenameField
                  initial={p.name}
                  onCancel={() => setRenaming(null)}
                  onDone={async (value) => {
                    const error = await onRename(p.name, value);
                    if (!error) setRenaming(null);
                    return error;
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="lib-open"
                  onClick={() => onOpen(p.name, compare ? activeSlot : "a")}
                  title={compare ? `Open in ${activeSlot.toUpperCase()}` : "Open"}
                >
                  <span className="lib-name">{p.name}</span>
                  <span className="lib-meta">
                    {relativeTime(p.modifiedAt, now)} · {formatSize(p.size)}
                  </span>
                  {slot ? <span className="lib-badge">{compare ? slot.toUpperCase() : "open"}</span> : null}
                </button>
              )}
              {renaming !== p.name ? (
                <div className="lib-actions">
                  {compare ? (
                    <button type="button" onClick={() => onOpen(p.name, activeSlot === "a" ? "b" : "a")}>
                      Open in {activeSlot === "a" ? "B" : "A"}
                    </button>
                  ) : null}
                  <button type="button" onClick={() => setRenaming(p.name)}>
                    Rename
                  </button>
                  <button type="button" onClick={() => onDuplicate(p.name)}>
                    Duplicate
                  </button>
                  <button type="button" onClick={() => onTrash(p.name)}>
                    Delete
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
        {visible.length === 0 ? <li className="lib-empty">{query ? "No pages match." : "No pages yet."}</li> : null}
      </ul>

      <div className="lib-trash">
        <button type="button" className="lib-trash-toggle" aria-expanded={showTrash} onClick={() => setShowTrash((s) => !s)}>
          {showTrash ? "▾" : "▸"} Trash ({trash.length})
        </button>
        {showTrash ? (
          <>
            <ul className="lib-list">
              {trash.map((t) => (
                <li key={t.id} className="lib-item lib-trashed">
                  <div className="lib-open" aria-disabled="true">
                    <span className="lib-name">{t.name}</span>
                    <span className="lib-meta">
                      deleted {relativeTime(t.trashedAt, now)} · {formatSize(t.size)}
                    </span>
                  </div>
                  <div className="lib-actions lib-actions-visible">
                    <button type="button" onClick={() => onRestore(t.id)}>
                      Restore
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Permanently delete “${t.name}”? This can’t be undone.`)) onPurge([t.id]);
                      }}
                    >
                      Delete forever
                    </button>
                  </div>
                </li>
              ))}
              {trash.length === 0 ? <li className="lib-empty">Trash is empty.</li> : null}
            </ul>
            {trash.length > 0 ? (
              <button
                type="button"
                className="btn btn-outline lib-empty-trash"
                onClick={() => {
                  if (window.confirm(`Permanently delete ${trash.length} page(s) in the trash? This can’t be undone.`)) {
                    onPurge(trash.map((t) => t.id));
                  }
                }}
              >
                Empty trash
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      <footer className="lib-foot">
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
