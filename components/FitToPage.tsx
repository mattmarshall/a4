"use client";

/**
 * Fit to page controls: the in-memory API key, the per-call consent dialog,
 * progress with cancel, and the outcome. The key never enters React state:
 * the field is uncontrolled and is cleared as soon as the key is handed to
 * the key module. Consent is minted only by the dialog's Send button, for
 * the exact text the dialog describes.
 */

import { useEffect, useRef, useState } from "react";
import { FIT_HOST, FIT_MODEL, FIT_TO_PAGE_ID } from "@/lib/models/fit/card";
import { forgetApiKey, hasApiKey, setApiKey } from "@/lib/models/fit/key";
import { grantConsent } from "@/lib/models/consent";
import type { ModelHost, TransformResult } from "@/lib/models/host";
import type { PageSpec } from "@/lib/page-spec";
import type { PageRef } from "@/lib/store";

type Phase =
  | { kind: "idle" }
  | { kind: "confirm"; name: string; ref: PageRef | null; text: string }
  | { kind: "running"; name: string; attempt: number; characters: number; note: string | null }
  | { kind: "failed"; message: string };

export function FitToPage({
  page,
  spec,
  host,
  onResult,
}: {
  /** The page Fit to page would rewrite (the active sheet). */
  page: { name: string | null; ref?: PageRef | null; text: string };
  spec: PageSpec;
  host: () => Promise<ModelHost>;
  /** Save the result beside the source; resolves once it's open. */
  onResult: (sourceName: string, result: TransformResult, sourceRef: PageRef | null) => Promise<void>;
}) {
  const [keySet, setKeySet] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const keyField = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const abort = useRef<AbortController | null>(null);

  // The key module outlives this component only within the tab.
  useEffect(() => setKeySet(hasApiKey()), []);

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
    if (!page.name || !page.text.trim()) return;
    setPhase({ kind: "confirm", name: page.name, ref: page.ref ?? null, text: page.text });
  }

  async function send(name: string, text: string, ref: PageRef | null) {
    // The only place a consent token is minted: for exactly this text.
    const consent = grantConsent(FIT_TO_PAGE_ID, text);
    const controller = new AbortController();
    abort.current = controller;
    setPhase({ kind: "running", name, attempt: 1, characters: 0, note: null });
    try {
      const h = await host();
      const result = await h.transform(FIT_TO_PAGE_ID, text, spec, {
        instruction: "fit",
        consent,
        signal: controller.signal,
        onProgress: ({ attempt, characters }) => setPhase((p) => (p.kind === "running" ? { ...p, attempt, characters } : p)),
        onAttempt: ({ attempt, rowsUsed, fits }) =>
          setPhase((p) =>
            p.kind === "running" && !fits
              ? { ...p, note: `Attempt ${attempt} used ${rowsUsed} rows; asking for a shorter version.`, characters: 0 }
              : p,
          ),
      });
      await onResult(name, result, ref);
      setPhase({ kind: "idle" });
    } catch (error) {
      const code = (error as { code?: string }).code;
      const message =
        code === "cancelled"
          ? "Canceled. No page was created."
          : `${error instanceof Error ? error.message : String(error)} No page was created.`;
      if (code === "auth") forget();
      setPhase({ kind: "failed", message });
    } finally {
      abort.current = null;
    }
  }

  const disabled = !keySet || !page.name || !page.text.trim() || phase.kind === "running";

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
            Claude is rewriting “{phase.name}” · attempt {phase.attempt} of 3 · {phase.characters.toLocaleString("en-US")} characters
          </span>
          {phase.note ? <span className="model-status">{phase.note}</span> : null}
          <button type="button" className="btn" onClick={() => abort.current?.abort()}>
            Cancel
          </button>
        </div>
      ) : null}
      {phase.kind === "failed" ? (
        <span className="model-status" role="alert">
          {phase.message}
        </span>
      ) : null}

      <dialog
        ref={dialog}
        className="consent-dialog"
        aria-labelledby="consent-title"
        onCancel={() => setPhase({ kind: "idle" })}
      >
        {phase.kind === "confirm" ? (
          <form
            method="dialog"
            onSubmit={(e) => {
              e.preventDefault();
              void send(phase.name, phase.text, phase.ref);
            }}
          >
            <h2 id="consent-title">Send this page to Anthropic?</h2>
            <dl>
              <dt>Destination</dt>
              <dd>
                <code>{FIT_HOST}</code> (Anthropic), directly from this browser. A4’s server never sees the page or
                your key.
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
              <button type="button" className="btn" onClick={() => setPhase({ kind: "idle" })}>
                Cancel
              </button>
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
