"use client";

/**
 * An installed pen's controls in the Models section: its instruction, any
 * credentials its card asks for (kept in this tab's memory, like Fit to
 * page's key), Run, progress with Cancel, and the outcome. A pen that keeps
 * text on the device runs at once; one that sends text away asks for consent
 * first, for the exact text shown. The request lives in a PenJob owned by
 * the Workbench, so it outlives this panel.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { type ModelCard, type PenJob, remoteHost } from "@/lib/models";
import type { PageRef } from "@/lib/persist";
import { ConsentDialog } from "./ConsentDialog";
import styles from "./ModelsPanel.module.css";

/** An installed pen's credentials, as the host's credential store holds them. */
export interface CredentialStoreView {
  has(kind: string): Promise<boolean>;
  set(kind: string, value: string): Promise<void>;
  forget(kind: string): Promise<void>;
}

export function PenControls({
  card,
  publisher,
  page,
  job,
  credentials,
  instruction,
  onInstruction,
}: {
  card: ModelCard;
  publisher: string | null;
  /** The page the pen would rewrite (the active sheet). */
  page: { name: string | null; ref: PageRef | null; text: string };
  job: PenJob<PageRef>;
  credentials: CredentialStoreView;
  instruction: string;
  onInstruction: (instruction: string) => void;
}) {
  const phase = useSyncExternalStore(job.subscribe, job.getSnapshot, job.getSnapshot);
  const [set, setSet] = useState<Record<string, boolean>>({});
  const fields = useRef<Record<string, HTMLInputElement | null>>({});
  const remote = remoteHost(card) !== null;
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
    const field = fields.current[kind];
    if (!field) return;
    const value = field.value;
    field.value = "";
    // Ask the store again: an empty value forgets the credential rather than setting it.
    void credentials
      .set(kind, value)
      .then(() => credentials.has(kind))
      .then((has) => setSet((s) => ({ ...s, [kind]: has })));
  }

  const missing = card.credentials.some((c) => !set[c.kind]);
  const ready = Boolean(page.name && page.ref && page.text.trim());
  const disabled = missing || !ready || phase.kind === "running";

  function run() {
    if (!page.name || !page.ref) return;
    const request = { name: page.name, ref: page.ref, text: page.text };
    if (remote) job.ask(request);
    else void job.run(request);
  }

  return (
    <div className={styles.fitControls}>
      {card.credentials.map((c) =>
        set[c.kind] ? (
          <div key={c.kind} className={styles.fitKey}>
            <span className={styles.status}>Your {c.label || c.kind} is set for this tab only.</span>
            <button
              type="button"
              className="btn"
              onClick={() => {
                void credentials.forget(c.kind);
                setSet((s) => ({ ...s, [c.kind]: false }));
              }}
            >
              Forget
            </button>
          </div>
        ) : (
          <form
            key={c.kind}
            className={styles.fitKey}
            onSubmit={(e) => {
              e.preventDefault();
              apply(c.kind);
            }}
          >
            <label className={styles.status} htmlFor={`pen-${card.id}-${c.kind}`}>
              Your {c.label || c.kind}. It’s kept in this tab’s memory only, never saved, and forgotten when you reload.
              It goes only to {remoteHost(card) ?? "this plugin"}.
            </label>
            <input
              id={`pen-${card.id}-${c.kind}`}
              ref={(el) => {
                fields.current[c.kind] = el;
              }}
              className={styles.fitKeyInput}
              type="password"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit" className="btn btn-outline">
              Use
            </button>
          </form>
        ),
      )}

      {instructions.length > 1 ? (
        <label className={styles.status}>
          Instruction{" "}
          <select value={instruction} onChange={(e) => onInstruction(e.target.value)}>
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
          {instruction || card.name}: “{page.name ?? "page"}”
        </button>
      </div>

      {phase.kind === "running" ? (
        <div className={styles.fitProgress} aria-live="polite">
          <span className={styles.status}>
            {card.name} is writing “{phase.name}” · attempt {phase.attempt}
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

      <ConsentDialog
        request={
          phase.kind === "confirm"
            ? { card, publisher, pageName: phase.name, characters: phase.text.length, action: "rewrite" }
            : null
        }
        onSend={() => void job.send()}
        onCancel={() => job.dismiss()}
      />
    </div>
  );
}
