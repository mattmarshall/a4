"use client";

/**
 * The Workbench's keyboard shortcuts, on one window listener:
 *
 * - Cmd/Ctrl+S saves now instead of opening the browser's save dialog.
 * - F toggles focus mode when nothing editable has focus.
 * - Esc closes the innermost thing open. Menus, dialogs, and fields handle
 *   their own Esc first and mark it handled (`preventDefault`); otherwise Esc
 *   goes to `escape` (the pose panel, then focus mode).
 */

import { useEffect, useRef } from "react";

export interface Shortcuts {
  save(): void;
  toggleFocus(): void;
  escape(): void;
}

/** True when typing goes into a field or a sheet. */
function editable(el: Element | null): boolean {
  if (!el || el === document.body) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    tag === "A4-SHEET" ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
}

/** True when an open dialog has the event: it handles its own Esc. */
function inDialog(e: KeyboardEvent): boolean {
  return e.target instanceof Element && e.target.closest("dialog[open]") !== null;
}

export function useShortcuts(shortcuts: Shortcuts): void {
  // The listener is attached once and reads the latest handlers.
  const latest = useRef(shortcuts);
  useEffect(() => {
    latest.current = shortcuts;
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const handlers = latest.current;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handlers.save();
        return;
      }
      if (e.key === "Escape") {
        if (!e.defaultPrevented && !inDialog(e)) handlers.escape();
        return;
      }
      if (
        (e.key === "f" || e.key === "F") &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !editable(document.activeElement)
      ) {
        e.preventDefault();
        handlers.toggleFocus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
