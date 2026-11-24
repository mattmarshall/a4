"use client";

/**
 * A small menu: a button that opens a popover list, closing on a choice, a
 * click outside, or Esc. Items are menuitem, menuitemradio, or
 * menuitemcheckbox buttons.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export function useOutsideClose(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Handled: the Workbench's Esc (pose panel, focus mode) waits for the next press.
      e.preventDefault();
      close();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

export function Menu({
  label,
  title,
  align = "right",
  className,
  children,
}: {
  label: ReactNode;
  title?: string;
  align?: "left" | "right";
  className?: string;
  /** Items; `close` dismisses the menu (items close it automatically). */
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useOutsideClose(open, close);
  return (
    <div className={`menu ${className ?? ""}`} ref={ref}>
      <button
        type="button"
        className="btn btn-outline"
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        onClick={() => setOpen((o) => !o)}
      >
        {label} ▾
      </button>
      {open ? (
        <div className="menu-list" data-align={align} role="menu">
          {children(close)}
        </div>
      ) : null}
    </div>
  );
}

export function MenuItem({
  onSelect,
  close,
  checked,
  kind = "item",
  disabled,
  title,
  children,
}: {
  onSelect: () => void;
  close: () => void;
  /** For radio and checkbox items. */
  checked?: boolean;
  kind?: "item" | "radio" | "checkbox";
  disabled?: boolean;
  title?: string | undefined;
  children: ReactNode;
}) {
  const role = kind === "radio" ? "menuitemradio" : kind === "checkbox" ? "menuitemcheckbox" : "menuitem";
  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-checked is set only when role is menuitemradio or menuitemcheckbox.
    <button
      type="button"
      role={role}
      className="menu-item"
      aria-checked={kind === "item" ? undefined : Boolean(checked)}
      disabled={disabled}
      title={title}
      onClick={() => {
        onSelect();
        close();
      }}
    >
      {children}
    </button>
  );
}
