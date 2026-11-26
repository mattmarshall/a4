"use client";

/**
 * Fit to page controls: the in-memory API key, the per-call consent dialog,
 * progress with cancel, and the outcome. The key never enters React state:
 * the field is uncontrolled and is cleared as soon as the key is handed to
 * the host's credential store. Consent is minted only by the dialog's Send button (the
 * job's `send`), for the exact text the dialog describes. The request itself
 * lives in a PenJob owned by the Workbench, so it outlives this panel.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FIT_TO_PAGE, type ModelCard, type PenJob, remoteHost } from "@/lib/models";
import type { PageRef } from "@/lib/persist";
import styles from "./ModelsPanel.module.css";
import { penProgress } from "./plugin-copy";

function useFitJob(job: PenJob<PageRef>) {
  return useSyncExternalStore(job.subscribe, job.getSnapshot, job.getSnapshot);
}

/** The top-bar chip for a pen's running rewrite: progress and Cancel, wherever the panel is. */
export function PenJobChip({ card, job }: { card: ModelCard; job: PenJob<PageRef> }) {
  const phase = useFitJob(job);
  if (phase.kind !== "running") return null;
  return (
    <span className={styles.fitChip} role="status" aria-live="polite">
      <span>
        {penProgress(card, phase.name)} · {phase.attempt}
        {phase.maxAttempts === null ? "" : `/${phase.maxAttempts}`}
      </span>
      <button type="button" className="btn" onClick={() => job.cancel()}>
        Cancel
      </button>
    </span>
  );
}

/** The API key, as the host's credential store holds it (the host loads on first use). */
export interface KeyStore {
  has(): Promise<boolean>;
  set(value: string): Promise<void>;
  forget(): Promise<void>;
}

export function FitToPage({
  page,
  job,
  apiKey,
}: {
  /** The page Fit to page would rewrite (the active sheet). */
  page: { name: string | null; ref: PageRef | null; text: string };
  /** The request, owned above the inspector so it outlives this panel. */
  job: PenJob<PageRef>;
  apiKey: KeyStore;
}) {
  const [keySet, setKeySet] = useState(false);
  const phase = useFitJob(job);
  const keyField = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  // The store outlives this component only within the tab. Re-read it when
  // the job changes phase (a rejected key is forgotten).
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read the key store each time the job changes phase.
  useEffect(() => {
    let live = true;
    void apiKey.has().then((has) => {
      if (live) setKeySet(has);
    });
    return () => {
      live = false;
    };
  }, [apiKey, phase.kind]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (phase.kind === "confirm" && !d.open) d.showModal();
    if (phase.kind !== "confirm" && d.open) d.close();
  }, [phase.kind]);

  function applyKey() {
    const field = keyField.current;
    if (!field) return;
    const value = field.value;
    field.value = "";
    void apiKey
      .set(value)
      .then(() => apiKey.has())
      .then(setKeySet);
  }

  function forget() {
    void apiKey.forget();
    setKeySet(false);
  }

  function ask() {
    if (!page.name || !page.ref || !page.text.trim()) return;
    job.ask({ name: page.name, ref: page.ref, text: page.text });
  }

  const disabled = !keySet || !page.name || !page.ref || !page.text.trim() || phase.kind === "running";

  return (
    <div className={styles.fitControls}>
      {keySet ? (
        <div className={styles.fitKey}>
          <span className={styles.status}>Your Anthropic API key is set for this tab only.</span>
          <button type="button" className="btn" onClick={forget}>
            Forget key
          </button>
        </div>
      ) : (
        <form
          className={styles.fitKey}
          onSubmit={(e) => {
            e.preventDefault();
            applyKey();
          }}
        >
          <label className={styles.status} htmlFor="fit-api-key">
            Your Anthropic API key. It’s kept in this tab’s memory only, never saved, and forgotten when you reload.
          </label>
          <input
            id="fit-api-key"
            ref={keyField}
            className={styles.fitKeyInput}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-…"
          />
          <button type="submit" className="btn btn-outline">
            Use key
          </button>
        </form>
      )}

      <div className="panel-actions">
        <button type="button" className="btn btn-outline" disabled={disabled} onClick={ask}>
          Fit “{page.name ?? "page"}” to the page
        </button>
      </div>
      <span className={styles.status}>Billed to your key: usually a few cents, up to about $0.50 with retries.</span>

      {phase.kind === "running" ? (
        <div className={styles.fitProgress} aria-live="polite">
          <span className={styles.status}>
            Claude is rewriting “{phase.name}” · attempt {phase.attempt}
            {phase.maxAttempts === null ? "" : ` of ${phase.maxAttempts}`} · {phase.characters.toLocaleString("en-US")}{" "}
            characters
          </span>
          {phase.note ? <span className={styles.status}>{phase.note}</span> : null}
          <button type="button" className="btn" onClick={() => job.cancel()}>
            Cancel
          </button>
        </div>
      ) : null}
      {phase.kind === "failed" ? (
        <span className={styles.status} role="alert">
          {phase.message}
        </span>
      ) : null}

      <dialog ref={dialog} className={styles.consent} aria-labelledby="consent-title" onCancel={() => job.dismiss()}>
        {phase.kind === "confirm" ? (
          <form
            method="dialog"
            onSubmit={(e) => {
              e.preventDefault();
              void job.send();
            }}
          >
            <h2 id="consent-title">Send this page to Anthropic?</h2>
            <dl>
              <dt>Destination</dt>
              <dd>
                <code>{remoteHost(FIT_TO_PAGE.card)}</code> (Anthropic), directly from this browser. A4’s server never
                sees the page or your key.
              </dd>
              <dt>Model</dt>
              <dd>
                <code>{FIT_TO_PAGE.card.model}</code>. If Claude declines, Anthropic may retry the request with a
                fallback model.
              </dd>
              <dt>Page</dt>
              <dd>
                “{phase.name}”, {phase.text.length.toLocaleString("en-US")} characters
              </dd>
            </dl>
            <p className={styles.status}>
              The rewrite opens as a new page in Compare. This page doesn’t change. You’ll be asked again next time.
            </p>
            <div className="panel-actions">
              <button type="button" className="btn" onClick={() => job.dismiss()}>
                Cancel
              </button>
              {/* biome-ignore lint/a11y/noAutofocus: the dialog opens on a click, and Send is its primary action. */}
              <button type="submit" className="btn btn-outline" autoFocus>
                Send
              </button>
            </div>
          </form>
        ) : null}
      </dialog>
    </div>
  );
}
