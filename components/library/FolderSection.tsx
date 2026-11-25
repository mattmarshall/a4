"use client";

/**
 * The Pages panel's folder section: the open folder's letters, stacks,
 * context files, and other Markdown, with New file, New letter, Save to
 * folder, and Close. Commands arrive grouped as `FolderActions`.
 */

import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { type FolderFile, MAX_FILE_BYTES, SCAN_ENTRY_LIMIT, fileRef, type PageRef } from "@/lib/persist";
import { compareLetterNames, type Letter, LETTERS_DIR, LetterState, type StackReport } from "@/lib/desk";
import type { FolderSnapshot, Slot } from "@/lib/workspace";
import { ENGLISH, formatByteLimit } from "../analysis-copy";
import { LETTER_STATE_LABEL, OUTCOME_WORD, stackProblems, stackUse } from "../desk-copy";
import styles from "../LibraryPanel.module.css";
import { formatSize, otherSlot, type Placement, relativeTime, slotOf } from "./shared";

export interface FolderActions {
  /** Pick a folder and open it. */
  pick(): void;
  reconnect(): void;
  /** Save open files, close the folder, and forget it. */
  close(): void;
  createFile(path: string): Promise<string | null>;
  /** Start a letter in `.agents/letters/` from the Handoff form. */
  createLetter(): Promise<string | null>;
  /** Open a letter, beside the one before it in Compare. */
  openLetter(ref: PageRef): void;
  /** Write the page "Save to folder…" was chosen for to `path`. */
  saveTo(path: string): Promise<string | null>;
  cancelSave(): void;
}

/** Where a page shows in the panel's badges and "Open in" buttons. */

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
  const over = file.rows !== null && file.rows > file.pageRows ? file.rows - file.pageRows : 0;
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
                {file.paper === "a4" ? "" : `${file.paper.toUpperCase()} · `}
                {file.rows} of {file.pageRows} rows{over ? `, ${over} over` : ""}
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

const STATE_KEY: Readonly<Record<LetterState, string>> = {
  [LetterState.UNSPECIFIED]: "draft",
  [LetterState.DRAFT]: "draft",
  [LetterState.ACCEPTED]: "accepted",
  [LetterState.RETURNED]: "returned",
  [LetterState.BROKEN]: "broken",
};

/** A letter's file name, without `.agents/letters/`. */
const letterName = (path: string) => path.slice(LETTERS_DIR.length + 1);

function LetterRow({
  file,
  letter,
  placement,
  onOpenLetter,
  onDuplicate,
}: {
  file: FolderFile;
  letter: Letter | undefined;
  placement: Placement;
  onOpenLetter: (ref: PageRef) => void;
  onDuplicate: (ref: PageRef) => void;
}) {
  const ref = fileRef(file.path);
  const slot = slotOf(placement, ref);
  const state = letter?.state ?? LetterState.DRAFT;
  const over = file.rows !== null && file.rows > file.pageRows ? file.rows - file.pageRows : 0;
  const postmark = letter?.postmark;
  const sealedBy = postmark && state !== LetterState.BROKEN ? ` by ${postmark.signer}` : "";
  return (
    <li className={`${styles.item} ${styles.file}`} data-open={slot ?? undefined}>
      <button
        type="button"
        className={styles.open}
        onClick={() => onOpenLetter(ref)}
        title={
          postmark?.reason ? `${LETTER_STATE_LABEL[state]}: ${postmark.reason}` : "Open beside the letter before it"
        }
      >
        <span className={`${styles.name} ${styles.path}`}>{letterName(file.path)}</span>
        <span className={styles.meta}>
          <span className={styles.letterState} data-state={STATE_KEY[state]}>
            {LETTER_STATE_LABEL[state]}
            {sealedBy}
          </span>
          {file.rows !== null ? (
            <>
              {" · "}
              <span className={styles.rows} data-over={over ? "" : undefined}>
                {file.paper === "a4" ? "" : `${file.paper.toUpperCase()} · `}
                {file.rows} of {file.pageRows} rows{over ? `, ${over} over` : ""}
              </span>
            </>
          ) : null}
        </span>
        {slot ? <span className={styles.badge}>{placement.compare ? slot.toUpperCase() : "open"}</span> : null}
      </button>
      <div className={styles.actions}>
        <button type="button" onClick={() => onDuplicate(ref)} title="Copy into a new library page">
          Duplicate to library
        </button>
      </div>
    </li>
  );
}

/** One stack: its name, pages used out of its budget, and its problem, then its pages in order. */
function StackGroup({
  stack,
  files,
  row,
}: {
  stack: StackReport;
  files: readonly FolderFile[];
  row: (f: FolderFile) => ReactNode;
}) {
  const byPath = new Map(files.map((f) => [f.path as string, f]));
  const pages = stack.pages.map((p) => byPath.get(p.path)).filter((f): f is FolderFile => f !== undefined);
  const [problem] = stackProblems(stack);
  const note = problem ? problem.charAt(0).toUpperCase() + problem.slice(1) : null;
  const state = OUTCOME_WORD[stack.outcome];
  return (
    <li className={styles.stack} data-state={state}>
      <div className={styles.stackHead}>
        <span className={styles.stackName}>{stack.name}</span>
        <span className={styles.stackUse}>{stackUse(stack)}</span>
      </div>
      {stack.label?.purpose ? <p className={styles.stackPurpose}>{stack.label.purpose}</p> : null}
      {note ? (
        <p className={styles.stackNote} role="status">
          {note}
        </p>
      ) : null}
      <ul className={styles.list}>{pages.map(row)}</ul>
    </li>
  );
}

export function FolderSection({
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
  const [letterError, setLetterError] = useState<string | null>(null);
  const { state } = folder;
  const letterOf = useMemo(() => new Map(folder.letters.map((l) => [l.path, l])), [folder.letters]);
  const hasLetters = folder.files.some((f) => f.group === "letter");
  async function newLetter() {
    setLetterError(await actions.createLetter());
  }

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("en-US");
    return q ? folder.files.filter((f) => f.path.toLocaleLowerCase("en-US").includes(q)) : folder.files;
  }, [folder.files, query]);
  // Newest first.
  const letters = visible
    .filter((f) => f.group === "letter")
    .sort((x, y) => compareLetterNames(letterName(y.path), letterName(x.path)));
  const context = visible.filter((f) => f.group === "context");
  const other = visible.filter((f) => f.group === "other");
  const stackFiles = visible.filter((f) => f.group === "stack");
  // A stack shows while any of its pages matches the search.
  const shownPaths = new Set<string>(stackFiles.map((f) => f.path));
  const stacks = folder.stacks.filter((s) => s.pages.length === 0 || s.pages.some((p) => shownPaths.has(p.path)));
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
          {hasLetters ? null : (
            <button
              type="button"
              className="btn"
              onClick={() => void newLetter()}
              title="Start a handoff letter in .agents/letters/"
            >
              + New letter
            </button>
          )}
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
      ) : null}
      {!saveRequest && creating ? (
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

      {letterError ? (
        <p className={styles.note} role="alert">
          Couldn’t start a letter: {letterError}
        </p>
      ) : null}

      {hasLetters ? (
        <>
          <div className={styles.groupHead}>
            <h3 className={`${styles.group} eyebrow`}>Letters</h3>
            <button
              type="button"
              className="btn"
              onClick={() => void newLetter()}
              title="Start a handoff letter in .agents/letters/"
            >
              + New letter
            </button>
          </div>
          <ul className={styles.list}>
            {letters.map((f) => (
              <LetterRow
                key={f.path}
                file={f}
                letter={letterOf.get(f.path)}
                placement={placement}
                onOpenLetter={actions.openLetter}
                onDuplicate={onDuplicate}
              />
            ))}
            {letters.length === 0 ? <li className={styles.empty}>No letters match.</li> : null}
          </ul>
        </>
      ) : null}

      {stacks.length > 0 ? (
        <>
          <h3 className={`${styles.group} eyebrow`}>Stacks</h3>
          <ul className={styles.stacks}>
            {stacks.map((stack) => (
              <StackGroup key={stack.name} stack={stack} files={stackFiles} row={row} />
            ))}
          </ul>
        </>
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
