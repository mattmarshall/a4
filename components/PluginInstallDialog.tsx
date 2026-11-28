"use client";

/**
 * Install plugin: choose a package file or paste an HTTPS URL. A4 checks the
 * package fully before showing anything to install, then says what the
 * plugin does, where it sends page text, what it downloads and asks for, and
 * who signed it. For an update it shows both versions and what changes.
 * Only Install (or Update) stores the plugin; Cancel stores nothing.
 */

import { useEffect, useRef, useState } from "react";
import type { Inspection } from "@/lib/models";
import styles from "./ModelsPanel.module.css";
import { installDialog } from "./plugin-copy";
import type { ModelsState } from "./useModels";

type Phase =
  | { readonly kind: "choose"; readonly error: string | null }
  | { readonly kind: "checking" }
  | { readonly kind: "review"; readonly inspection: Inspection; readonly error: string | null }
  | { readonly kind: "installing"; readonly inspection: Inspection };

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function PluginInstallDialog({
  open,
  initial,
  models,
  onClose,
  onInstalled,
}: {
  open: boolean;
  /** An inspection to review at once: Check for update found a package. */
  initial: Inspection | null;
  models: ModelsState;
  onClose: () => void;
  onInstalled: (name: string, update: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "choose", error: null });
  const [url, setUrl] = useState("");

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setPhase(initial ? { kind: "review", inspection: initial, error: null } : { kind: "choose", error: null });
      setUrl("");
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open, initial]);

  async function check(inspect: () => Promise<Inspection>) {
    setPhase({ kind: "checking" });
    try {
      setPhase({ kind: "review", inspection: await inspect(), error: null });
    } catch (error) {
      setPhase({ kind: "choose", error: message(error) });
    }
  }

  async function confirm(inspection: Inspection) {
    setPhase({ kind: "installing", inspection });
    try {
      await models.install(inspection);
      onInstalled(inspection.pkg.card.name, inspection.kind.is === "update");
      onClose();
    } catch (error) {
      setPhase({ kind: "review", inspection, error: message(error) });
    }
  }

  const copy = phase.kind === "review" || phase.kind === "installing" ? installDialog(phase.inspection) : null;
  return (
    <dialog ref={dialog} className={styles.consent} aria-labelledby="install-title" onCancel={onClose}>
      {phase.kind === "choose" || phase.kind === "checking" ? (
        <div className={styles.install}>
          <h2 id="install-title">Install a plugin</h2>
          <p className={styles.status}>
            A plugin is a signed .a4plugin file. A4 checks its signature and code before anything runs, and runs it in a
            sandbox that holds it to what its card says.
          </p>
          <label className={styles.status}>
            From a file{" "}
            <input
              type="file"
              accept=".a4plugin,application/vnd.a4.plugin"
              disabled={phase.kind === "checking"}
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                if (file) void check(() => models.inspectFile(file));
              }}
            />
          </label>
          <form
            className={styles.field}
            onSubmit={(e) => {
              e.preventDefault();
              if (url.trim()) void check(() => models.inspectUrl(url.trim()));
            }}
          >
            <label className={styles.status} htmlFor="install-url">
              Or from an HTTPS URL. A4 downloads it only when you choose Check, and sends no page text.
            </label>
            <input
              id="install-url"
              className={styles.fieldInput}
              type="url"
              inputMode="url"
              placeholder="https://example.com/plugin.a4plugin"
              value={url}
              disabled={phase.kind === "checking"}
              onChange={(e) => setUrl(e.target.value)}
            />
            <button type="submit" className="btn btn-outline" disabled={phase.kind === "checking" || !url.trim()}>
              Check
            </button>
          </form>
          {phase.kind === "checking" ? <span className={styles.status}>Checking…</span> : null}
          {phase.kind === "choose" && phase.error ? (
            <span className={styles.status} role="alert">
              {phase.error}
            </span>
          ) : null}
          <div className="panel-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {copy && (phase.kind === "review" || phase.kind === "installing") ? (
        <form
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault();
            void confirm(phase.inspection);
          }}
        >
          <h2 id="install-title">{copy.title}</h2>
          {copy.changes.length > 0 ? (
            <ul className={styles.changes}>
              {copy.changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          ) : null}
          <dl>
            {copy.rows.map((row) => (
              <div key={row.label} className={styles.row}>
                <dt>{row.label}</dt>
                <dd>{row.label === "Fingerprint" ? <code>{row.value}</code> : row.value}</dd>
              </div>
            ))}
          </dl>
          {phase.inspection.known ? null : (
            <p className={styles.status}>
              A4 doesn’t know this publisher. Install it only if you trust whoever gave you this file, and check the
              fingerprint with them.
            </p>
          )}
          {phase.kind === "review" && phase.error ? (
            <span className={styles.status} role="alert">
              {phase.error}
            </span>
          ) : null}
          <div className="panel-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-outline" disabled={phase.kind === "installing"}>
              {copy.confirm}
            </button>
          </div>
        </form>
      ) : null}
    </dialog>
  );
}
