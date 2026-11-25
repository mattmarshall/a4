"use client";

/**
 * The per-call consent dialog for a plugin that sends page text off the
 * device: an installed pen's rewrite, or a remote overlay's score. It names
 * the destination host, the plugin and its publisher, the model, the page,
 * and the characters sent. Only Send approves the call; Cancel sends nothing.
 * (Fit to page has its own dialog in FitToPage.tsx.)
 */

import { useEffect, useRef } from "react";
import { type ModelCard, remoteHost } from "@/lib/models";
import styles from "./ModelsPanel.module.css";

export interface ConsentRequest {
  readonly card: ModelCard;
  /** Who published the plugin, for an installed one. */
  readonly publisher: string | null;
  readonly pageName: string;
  readonly characters: number;
  readonly action: "score" | "rewrite";
}

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

  const host = request ? remoteHost(request.card) : null;
  return (
    <dialog ref={dialog} className={styles.consent} aria-labelledby="plugin-consent-title" onCancel={onCancel}>
      {request ? (
        <form
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault();
            onSend();
          }}
        >
          <h2 id="plugin-consent-title">Send this page to {host}?</h2>
          <dl>
            <dt>Destination</dt>
            <dd>
              <code>{host}</code>, directly from this browser. A4’s server never sees the page.
            </dd>
            <dt>Plugin</dt>
            <dd>
              {request.card.name} {request.card.version}
              {request.publisher ? ` · ${request.publisher}` : ""}
            </dd>
            {request.card.model ? (
              <>
                <dt>Model</dt>
                <dd>
                  <code>{request.card.model}</code>
                </dd>
              </>
            ) : null}
            <dt>Page</dt>
            <dd>
              “{request.pageName}”, {request.characters.toLocaleString("en-US")} characters
            </dd>
          </dl>
          <p className={styles.status}>
            {request.action === "rewrite"
              ? "The rewrite opens as a new page in Compare. This page doesn’t change. You’ll be asked again next time."
              : "The scores tint this page as a lens. You’ll be asked again before it scores the page again."}
          </p>
          <div className="panel-actions">
            <button type="button" className="btn" onClick={onCancel}>
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
  );
}
