"use client";

/**
 * Sealing a letter: the dialog that accepts or returns a draft letter, and the
 * chip a sealed letter shows on the desk. A seal records that a person read
 * the letter and accepted or returned it; it isn't a verdict on its truth, and
 * nothing here shows one as a trust score.
 */

import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useEffect, useRef, useState } from "react";
import { type Letter, LetterState, LetterVerdict } from "@/lib/desk";
import { BROKEN_SEAL_REASON } from "./desk-copy";
import styles from "./SealDialog.module.css";

export type SealVerdict = "accepted" | "returned";

export interface SealDialogProps {
  open: boolean;
  /** The letter's file name. */
  letterName: string;
  /** Rows over the page (0 when it fits): Accept needs the letter to fit. */
  overBy: number;
  /** The name remembered from the last seal in this browser. */
  signer: string | null;
  /** Write the seal; resolves to an error message, or null once sealed. */
  onSeal: (verdict: SealVerdict, reason: string, signer: string) => Promise<string | null>;
  onClose: () => void;
}

export function SealDialog({ open, letterName, overBy, signer, onSeal, onClose }: SealDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(signer ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) {
      setName(signer ?? "");
      setReason("");
      setError(null);
      el.showModal();
    } else if (!open && el.open) el.close();
  }, [open, signer]);

  async function seal(verdict: SealVerdict) {
    if (busy) return;
    if (!name.trim()) {
      setError("Enter your name to seal the letter.");
      return;
    }
    if (verdict === "returned" && !reason.trim()) {
      setError("Say why you’re returning the letter.");
      return;
    }
    setBusy(true);
    setError(null);
    const message = await onSeal(verdict, reason.trim(), name.trim());
    setBusy(false);
    if (message) setError(message);
  }

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="seal-title" onCancel={onClose}>
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          void seal("accepted");
        }}
      >
        <h2 id="seal-title">Seal “{letterName}”</h2>
        <p className={styles.meaning}>
          Sealing records that you read this letter and accept it, or return it with a reason. It doesn’t make the
          letter true. Once sealed, the letter can’t be edited; only an accepted letter is delivered to the next
          session.
        </p>
        <label className={styles.field}>
          <span>Your name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            spellCheck={false}
            required
          />
        </label>
        <label className={styles.field}>
          <span>Reason (required to return)</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        </label>
        {overBy > 0 ? (
          <p className={styles.over} role="status">
            The letter is {overBy} {overBy === 1 ? "row" : "rows"} over the page, so it can’t be accepted. Cut it, or
            return it.
          </p>
        ) : null}
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        <div className="panel-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-outline" onClick={() => void seal("returned")} disabled={busy}>
            Return
          </button>
          {/* biome-ignore lint/a11y/noAutofocus: the dialog opens on a click, and Accept is its primary action. */}
          <button type="submit" className="btn btn-outline" disabled={busy || overBy > 0} autoFocus={overBy === 0}>
            Accept
          </button>
        </div>
      </form>
    </dialog>
  );
}

function sealedWhen(letter: Letter): string {
  const at = letter.postmark?.sealedAt;
  if (!at) return "";
  return timestampDate(at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** A sealed letter's chip on the desk: its verdict, signer, and time, or why its seal is broken. */
export function SealedChip({ letter }: { letter: Letter }) {
  const postmark = letter.postmark;
  if (letter.state === LetterState.BROKEN) {
    return (
      <span className={styles.chip} data-state="broken" role="status">
        Seal broken: the letter {BROKEN_SEAL_REASON[letter.broken]}. It won’t be delivered.
      </span>
    );
  }
  if (!postmark) return null;
  const accepted = postmark.verdict === LetterVerdict.ACCEPTED;
  return (
    <span
      className={styles.chip}
      data-state={accepted ? "accepted" : "returned"}
      role="status"
      title={postmark.reason || undefined}
    >
      Sealed · {accepted ? "Accepted" : "Returned"} by {postmark.signer}, {sealedWhen(letter)}
      {!accepted && postmark.reason ? `: ${postmark.reason}` : ""}
    </span>
  );
}
