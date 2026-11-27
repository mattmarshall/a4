"use client";

/**
 * A pen's panel in the Models section, the same for every pen, Fit to page
 * and installed ones alike: a field for each credential its card declares,
 * the instruction when its card offers more than one, Run, a cost line when
 * there is one, progress with Cancel, and the outcome. Its words come from
 * `penPanel(card)`.
 *
 * - A pen that sends text away asks for consent first, in the Workbench's
 *   one consent dialog, for the exact text shown. One that keeps text on the
 *   device runs at once.
 * - Credentials stay in this tab's memory: a field is uncontrolled, and is
 *   cleared as soon as its value is handed to the host's credential store.
 * - The request lives in the pen's PenJob, owned above the inspector, so it
 *   outlives this panel.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { type ModelCard, type PenJob, remoteHost } from "@/lib/models";
import type { PageRef } from "@/lib/persist";
import styles from "./ModelsPanel.module.css";
import { penPanel, penProgress } from "./plugin-copy";
import type { Pen } from "./workbench/usePens";

function usePhase(job: PenJob<PageRef>) {
  return useSyncExternalStore(job.subscribe, job.getSnapshot, job.getSnapshot);
}

/** The top-bar chip for a pen's running rewrite: progress and Cancel, wherever the panel is. */
export function PenJobChip({ card, job }: { card: ModelCard; job: PenJob<PageRef> }) {
  const phase = usePhase(job);
  if (phase.kind !== "running") return null;
  return (
    <span className={styles.penChip} role="status" aria-live="polite">
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

export function PenPanel({
  pen,
  page,
}: {
  pen: Pen;
  /** The page the pen would rewrite (the active sheet). */
  page: { name: string | null; ref: PageRef | null; text: string };
}) {
  const { card, job, credentials } = pen;
  const copy = penPanel(card);
  const phase = usePhase(job);
  const [set, setSet] = useState<Readonly<Record<string, boolean>>>({});
  const fields = useRef(new Map<string, HTMLInputElement>());
  const instructions = card.transform?.instructions ?? [];

  // Re-read the credential store when the job changes phase (a rejected key is forgotten).
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read the store each time the job changes phase.
  useEffect(() => {
    let live = true;
    void Promise.all(card.credentials.map(async (c) => [c.kind, await credentials.has(c.kind)] as const)).then(
      (entries) => {
        if (live) setSet(Object.fromEntries(entries));
      },
    );
    return () => {
      live = false;
    };
  }, [card, credentials, phase.kind]);

  function apply(kind: string) {
    const field = fields.current.get(kind);
    if (!field) return;
    const value = field.value;
    field.value = "";
    // Ask the store again: an empty value forgets the credential rather than setting it.
    void credentials
      .set(kind, value)
      .then(() => credentials.has(kind))
      .then((has) => setSet((s) => ({ ...s, [kind]: has })));
  }

  function forget(kind: string) {
    void credentials.forget(kind);
    setSet((s) => ({ ...s, [kind]: false }));
  }

  const missing = card.credentials.some((c) => !set[c.kind]);
  const ready = Boolean(page.name && page.ref && page.text.trim());
  const disabled = missing || !ready || phase.kind === "running";

  function run() {
    if (!page.name || !page.ref) return;
    const request = { name: page.name, ref: page.ref, text: page.text };
    if (remoteHost(card) !== null) job.ask(request);
    else void job.run(request);
  }

  return (
    <div className={styles.penControls}>
      {card.credentials.map((c) =>
        set[c.kind] ? (
          <div key={c.kind} className={styles.penKey}>
            <span className={styles.status}>{copy.credentialSet(c)}</span>
            <button type="button" className="btn" onClick={() => forget(c.kind)}>
              {copy.forgetKey}
            </button>
          </div>
        ) : (
          <form
            key={c.kind}
            className={styles.penKey}
            onSubmit={(e) => {
              e.preventDefault();
              apply(c.kind);
            }}
          >
            <label className={styles.status} htmlFor={`pen-${card.id}-${c.kind}`}>
              {copy.credentialPrompt(c)}
            </label>
            <input
              id={`pen-${card.id}-${c.kind}`}
              ref={(el) => {
                if (el) fields.current.set(c.kind, el);
                else fields.current.delete(c.kind);
              }}
              className={styles.penKeyInput}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={copy.placeholder ?? undefined}
            />
            <button type="submit" className="btn btn-outline">
              {copy.useKey}
            </button>
          </form>
        ),
      )}

      {instructions.length > 1 ? (
        <label className={styles.status}>
          Instruction{" "}
          <select value={pen.instruction} onChange={(e) => pen.setInstruction(e.target.value)}>
            {instructions.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="panel-actions">
        <button type="button" className="btn btn-outline" disabled={disabled} onClick={run}>
          {copy.run(page.name ?? "page", pen.instruction)}
        </button>
      </div>
      {copy.cost ? <span className={styles.status}>{copy.cost}</span> : null}

      {phase.kind === "running" ? (
        <div className={styles.penProgress} aria-live="polite">
          <span className={styles.status}>{copy.progress(phase)}</span>
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
    </div>
  );
}
