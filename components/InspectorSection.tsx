"use client";

/**
 * A collapsible inspector section. The title is a button; the open state is
 * remembered per section (`inspectorSection` in lib/settings.ts).
 */

import { useEffect, useMemo, type ReactNode } from "react";
import { inspectorSection } from "@/lib/settings";
import { useSetting } from "./useSetting";

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
  const setting = useMemo(() => inspectorSection(id, defaultOpen), [id, defaultOpen]);
  const [open, setOpen] = useSetting(setting);

  useEffect(() => {
    if (openWhen) setOpen(true);
  }, [openWhen, setOpen]);

  function toggle() {
    setOpen(!open);
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
