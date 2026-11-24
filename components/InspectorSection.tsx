"use client";

/**
 * A collapsible inspector section. The title is a button; the open state is
 * remembered per section (`inspectorSection` in lib/settings.ts).
 */

import { useEffect, useMemo, type ReactNode } from "react";
import { inspectorSection } from "@/lib/persist";
import styles from "./InspectorSection.module.css";
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
    <section
      className={className ? `${styles.section} ${className}` : styles.section}
      data-open={open ? "" : undefined}
      aria-label={label}
    >
      <h2 className={`${styles.title} eyebrow`}>
        <button type="button" className={styles.toggle} aria-expanded={open} onClick={toggle}>
          <span className={styles.chevron} aria-hidden="true">
            ▸
          </span>
          <span>{title}</span>
          {badge !== undefined && badge !== null ? <span className={styles.badge}>{badge}</span> : null}
        </button>
      </h2>
      {open ? <div>{children}</div> : null}
    </section>
  );
}
