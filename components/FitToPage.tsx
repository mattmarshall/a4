"use client";

/**
 * Fit to page controls: the in-memory API key, the per-call consent dialog,
 * progress with cancel, and the outcome. The key never enters React state:
 * the field is uncontrolled and is cleared as soon as the key is handed to
 * the key module. Consent is minted only by the dialog's Send button (the
 * job's `send`), for the exact text the dialog describes. The request itself
 * lives in a FitJob owned by the Workbench, so it outlives this panel.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FIT_HOST, FIT_MODEL, type FitJob, forgetApiKey, hasApiKey, setApiKey } from "@/lib/models";
import type { PageRef } from "@/lib/persist";

export function useFitJob(job: FitJob<PageRef>) {
  return useSyncExternalStore(job.subscribe, job.getSnapshot, job.getSnapshot);
}

/** The top-bar chip for a running rewrite: progress and Cancel, wherever the panel is. */
export function FitJobChip({ job }: { job: FitJob<PageRef> }) {
  const phase = useFitJob(job);
  if (phase.kind !== "running") return null;
  return (
    <span className="fit-chip" role="status" aria-live="polite">
      <span className="fit-chip-label">
        Fitting “{phase.name}” · {phase.attempt}/{phase.maxAttempts}
      </span>
      <button type="button" className="btn" onClick={() => job.cancel()}>
        Cancel
      </button>
    </span>
  );
}

export function FitToPage({
  page,
  job,
}: {
  /** The page Fit to page would rewrite (the active sheet). */
  page: { name: string | null; ref: PageRef | null; text: string };
  /** The request, owned above the inspector so it outlives this panel. */
  job: FitJob<PageRef>;
}) {
  const [keySet, setKeySet] = useState(false);
  const phase = useFitJob(job);
  const keyField = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  // The key module outlives this component only within the tab.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read the key store each time the job changes phase.
  useEffect(() => setKeySet(hasApiKey()), [phase.kind]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (phase.kind === "confirm" && !d.open) d.showModal();
    if (phase.kind !== "confirm" && d.open) d.close();
  }, [phase.kind]);

  function applyKey() {
    const field = keyField.current;
    if (!field) return;
    setApiKey(field.value);
    field.value = "";
    setKeySet(hasApiKey());
  }

  function forget() {
    forgetApiKey();
    setKeySet(false);
  }

  function ask() {
    if (!page.name || !page.ref || !page.text.trim()) return;
    job.ask({ name: page.name, ref: page.ref, text: page.text });
  }

  const disabled = !keySet || !page.name || !page.ref || !page.text.trim() || phase.kind === "running";

  return (
    <div className="fit-controls">
      {keySet ? (
        <div className="fit-key">
          <span className="model-status">Your Anthropic API key is set for this tab only.</span>
          <button type="button" className="btn" onClick={forget}>
            Forget key
          </button>
        </div>
      ) : (
        <form
          className="fit-key"
          onSubmit={(e) => {
            e.preventDefault();
            applyKey();
          }}
        >
          <label className="model-status" htmlFor="fit-api-key">
            Your Anthropic API key. It’s kept in this tab’s memory only, never saved, and forgotten when you reload.
          </label>
          <input
            id="fit-api-key"
            ref={keyField}
            className="fit-key-input"
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
      <span className="model-status">Billed to your key: usually a few cents, up to about $0.50 with retries.</span>

      {phase.kind === "running" ? (
        <div className="fit-progress" aria-live="polite">
          <span className="model-status">
            Claude is rewriting “{phase.name}” · attempt {phase.attempt} of {phase.maxAttempts} ·{" "}
            {phase.characters.toLocaleString("en-US")} characters
          </span>
          {phase.note ? <span className="model-status">{phase.note}</span> : null}
          <button type="button" className="btn" onClick={() => job.cancel()}>
            Cancel
          </button>
        </div>
      ) : null}
      {phase.kind === "failed" ? (
        <span className="model-status" role="alert">
          {phase.message}
        </span>
      ) : null}

      <dialog ref={dialog} className="consent-dialog" aria-labelledby="consent-title" onCancel={() => job.dismiss()}>
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
                <code>{FIT_HOST}</code> (Anthropic), directly from this browser. A4’s server never sees the page or your
                key.
              </dd>
              <dt>Model</dt>
              <dd>
                <code>{FIT_MODEL}</code>. If Claude declines, Anthropic may retry the request with a fallback model.
              </dd>
              <dt>Page</dt>
              <dd>
                “{phase.name}”, {phase.text.length.toLocaleString("en-US")} characters
              </dd>
            </dl>
            <p className="model-status">
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
