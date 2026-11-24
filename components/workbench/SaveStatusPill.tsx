"use client";

import type { SaveStatus } from "@/lib/persist";

const STATUS_LABEL: Record<SaveStatus, string> = {
  saved: "Saved",
  unsaved: "Unsaved changes",
  saving: "Saving…",
  error: "Save failed · retrying",
};

/** `compact`: on medium and narrow windows the pill shrinks to its dot (the top bar's). */
export function SaveStatusPill({ status, compact = false }: { status: SaveStatus; compact?: boolean }) {
  return (
    <span
      className="save-pill"
      data-status={status}
      data-compact={compact ? "" : undefined}
      role="status"
      aria-live="polite"
      title={STATUS_LABEL[status]}
    >
      <span className={compact ? "visually-hidden-medium" : undefined}>{STATUS_LABEL[status]}</span>
    </span>
  );
}
