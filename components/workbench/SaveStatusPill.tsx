"use client";

import type { SaveStatus } from "@/lib/autosave";

const STATUS_LABEL: Record<SaveStatus, string> = {
  saved: "Saved",
  unsaved: "Unsaved changes",
  saving: "Saving…",
  error: "Save failed · retrying",
};

export function SaveStatusPill({ status }: { status: SaveStatus }) {
  return (
    <span className="save-pill" data-status={status} role="status" aria-live="polite" title={STATUS_LABEL[status]}>
      <span className="save-label">{STATUS_LABEL[status]}</span>
    </span>
  );
}
