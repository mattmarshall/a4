"use client";

/**
 * The one per-call consent dialog, for every call that sends page text off
 * the device: Fit to page, an installed pen's rewrite, or a remote overlay's
 * score. The Workbench mounts it once, for the call `pendingConsent` picks.
 * Its words come from `consentDialog(request)`: the destination host, the
 * plugin, the model, the page, the characters sent, and what stays out of
 * A4's server. Only Send approves the call; Cancel sends nothing.
 */

import { useEffect, useRef } from "react";
import styles from "./ModelsPanel.module.css";
import { type ConsentRequest, consentDialog } from "./plugin-copy";

export function ConsentDialog({
  request,
  onSend,
  onCancel,
}: {
  request: ConsentRequest | null;
  onSend: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (request && !d.open) d.showModal();
    if (!request && d.open) d.close();
  }, [request]);

  const copy = request ? consentDialog(request) : null;
  return (
    <dialog ref={dialog} className={styles.consent} aria-labelledby="plugin-consent-title" onCancel={onCancel}>
      {copy ? (
        <form
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault();
            onSend();
          }}
        >
          <h2 id="plugin-consent-title">{copy.title}</h2>
          <dl>
            {copy.rows.map((row) => (
              <div key={row.label} className={styles.row}>
                <dt>{row.label}</dt>
                <dd>
                  {row.code ? <code>{row.code}</code> : null}
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
          <p className={styles.status}>{copy.note}</p>
          <div className="panel-actions">
            <button type="button" className="btn" onClick={onCancel}>
              {copy.cancel}
            </button>
            {/* biome-ignore lint/a11y/noAutofocus: the dialog opens on a click, and Send is its primary action. */}
            <button type="submit" className="btn btn-outline" autoFocus>
              {copy.send}
            </button>
          </div>
        </form>
      ) : null}
    </dialog>
  );
}
