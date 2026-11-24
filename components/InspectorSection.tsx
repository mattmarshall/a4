"use client";

/**
 * A collapsible inspector section. The title is a button; the open state is
 * remembered per section as a scalar setting (`inspector:<id>`).
 */

import { useEffect, useState, type ReactNode } from "react";
import { readKey, writeKey } from "@/lib/storage";

export function InspectorSection({
  id,
  title,
  defaultOpen,
  badge,
  openWhen,
  className,
  label,
  children,
}: {
  id: string;
  title: ReactNode;
  defaultOpen: boolean;
  /** Shown beside the title, even while collapsed (e.g. a count). */
  badge?: ReactNode;
  /** When this becomes true, the section opens (and remembers it). */
  openWhen?: boolean;
  className?: string;
  /** Accessible name for the region, when the title isn't plain text. */
  label?: string;
  children: ReactNode;
}) {
  const key = `inspector:${id}`;
  const [open, setOpen] = useState(defaultOpen);

  // Restore after mount (the page is prerendered with defaults).
  useEffect(() => {
    const stored = readKey(key);
    if (stored !== null) setOpen(stored === "1");
  }, [key]);

  useEffect(() => {
    if (!openWhen) return;
    setOpen(true);
    writeKey(key, "1");
  }, [openWhen, key]);

  function toggle() {
    setOpen((was) => {
      writeKey(key, was ? "0" : "1");
      return !was;
    });
  }

  return (
    <section className={`panel-section ${className ?? ""}`} data-open={open ? "" : undefined} aria-label={label}>
      <h2 className="panel-title">
        <button type="button" className="section-toggle" aria-expanded={open} onClick={toggle}>
          <span className="chevron" aria-hidden="true">
            ▸
          </span>
          <span>{title}</span>
          {badge !== undefined && badge !== null ? <span className="section-badge">{badge}</span> : null}
        </button>
      </h2>
      {open ? <div className="section-body">{children}</div> : null}
    </section>
  );
}
