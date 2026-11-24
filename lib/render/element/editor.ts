/**
 * The sheet's editing surface: a transparent textarea laid over the grid. It
 * is the only owner of native editing (typing, Tab, paste, drop, IME,
 * selection, focus, and undo), and keeps tabs and carriage returns out of
 * the text without breaking undo.
 */

import { fontSizeMm, normalizeText, TAB_SPACES, type PageSpec } from "../../page/index.ts";
import { needsNormalizing, normalizeEdit } from "./normalize.ts";

export interface EditorEvents {
  /** The text changed by user input. */
  input(): void;
  /** The caret, the selection, or focus changed. */
  selection(): void;
  /** The textarea gained focus. */
  focus(): void;
}

export interface EditorSelection {
  readonly start: number;
  readonly end: number;
  readonly focused: boolean;
}

/**
 * Insert text at the caret through native editing, so undo can remove it.
 * `ownStep` keeps it from merging with the typing before it (a drop or a
 * paste is its own undo step); without it, it merges like a typed character.
 */
function insertAtCaret(el: HTMLTextAreaElement, insert: string, ownStep: boolean) {
  el.focus({ preventScroll: true });
  // Setting the selection, even to itself, ends the typing run Chrome would merge this into.
  if (ownStep) el.setSelectionRange(el.selectionStart, el.selectionEnd, el.selectionDirection);
  // execCommand is deprecated but is still the only way to keep native undo.
  const ok = typeof document.execCommand === "function" && document.execCommand("insertText", false, insert);
  if (!ok) {
    el.setRangeText(insert, el.selectionStart, el.selectionEnd, "end");
    el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  }
}

/** Insertions whose text the editor may replace with a cleaned copy before it lands. */
const CLEANABLE = new Set(["insertText", "insertReplacementText", "insertFromDrop", "insertFromYank", "insertLink"]);

export class EditorSurface {
  readonly element: HTMLTextAreaElement;
  readonly #root: ShadowRoot;
  readonly #events: EditorEvents;
  /** The text after the last edit, to find the range the next one changed. */
  #last = "";
  #seeded = false;
  #onDocSelection = () => {
    if (this.focused) this.#events.selection();
  };

  constructor(root: ShadowRoot, events: EditorEvents) {
    this.#root = root;
    this.#events = events;
    const el = document.createElement("textarea");
    el.className = "input";
    el.spellcheck = false;
    el.setAttribute("autocorrect", "off");
    el.setAttribute("autocapitalize", "off");
    el.setAttribute("autocomplete", "off");
    el.setAttribute("wrap", "soft");
    el.placeholder = "Write the context you would hand an agent…";
    this.element = el;

    el.addEventListener("beforeinput", (e) => this.#beforeInput(e));
    el.addEventListener("input", (e) => {
      // While an input method composes, leave its text alone; compositionend cleans it.
      if (!(e as InputEvent).isComposing) {
        this.#normalize();
        this.#last = el.value;
      }
      this.#events.input();
    });
    el.addEventListener("compositionend", () => {
      if (this.#normalize()) this.#events.input();
      this.#last = el.value;
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Tab" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        insertAtCaret(el, TAB_SPACES, false);
      }
    });
    el.addEventListener("paste", (e) => {
      const raw = e.clipboardData?.getData("text/plain");
      if (!raw || !needsNormalizing(raw)) return;
      e.preventDefault();
      insertAtCaret(el, normalizeText(raw), true);
    });
    el.addEventListener("focus", () => {
      this.#events.focus();
      this.#events.selection();
    });
    for (const type of ["blur", "select", "keyup", "selectionchange", "pointerup"]) {
      el.addEventListener(type, () => this.#events.selection());
    }
  }

  /** Listen for document selection changes while the sheet is in the document. */
  connect(): void {
    document.addEventListener("selectionchange", this.#onDocSelection);
  }

  disconnect(): void {
    document.removeEventListener("selectionchange", this.#onDocSelection);
  }

  get value(): string {
    return this.element.value;
  }

  /** Replace the text (not an edit: it isn't cleaned or undoable), keeping the caret within it. */
  set value(text: string) {
    this.#seeded = true;
    const el = this.element;
    if (el.value === text) return;
    const { selectionStart: s, selectionEnd: e } = el;
    el.value = text;
    this.#last = text;
    el.setSelectionRange(Math.min(s, text.length), Math.min(e, text.length));
  }

  /** The `value` attribute's text, until the text is first set some other way. */
  seed(text: string): void {
    if (!this.#seeded) this.value = text;
  }

  get focused(): boolean {
    return this.#root.activeElement === this.element;
  }

  get selection(): EditorSelection {
    return { start: this.element.selectionStart, end: this.element.selectionEnd, focused: this.focused };
  }

  select(start: number, end: number, direction?: "forward" | "backward" | "none"): void {
    this.element.setSelectionRange(start, end, direction);
    this.#events.selection();
  }

  focus(options?: FocusOptions): void {
    this.element.focus({ preventScroll: true, ...options });
  }

  setLabel(label: string): void {
    if (label) this.element.setAttribute("aria-label", label);
    else this.element.removeAttribute("aria-label");
  }

  /** Lay the textarea over the page's grid at `scale` CSS px per mm. */
  layout(spec: PageSpec, scale: number, rowsTotal: number): void {
    const s = this.element.style;
    s.left = `${spec.marginX * scale}px`;
    s.top = `${spec.marginY * scale}px`;
    // Half a cell of slack absorbs float drift without admitting column cols + 1.
    s.width = `${(spec.cols + 0.5) * spec.cellW * scale}px`;
    s.height = `${Math.max(spec.rows, rowsTotal) * spec.cellH * scale}px`;
    s.fontSize = `${fontSizeMm(spec) * scale}px`;
    s.lineHeight = `${spec.cellH * scale}px`;
  }

  /**
   * Replace an insertion that carries tabs or carriage returns with its
   * cleaned text, inserted as its own native undo step (so one undo removes
   * the whole drop, not just the cleanup). Never during composition.
   */
  #beforeInput(e: InputEvent) {
    if (e.isComposing || !e.cancelable || !CLEANABLE.has(e.inputType)) return;
    const data = e.data ?? e.dataTransfer?.getData("text/plain") ?? null;
    if (!data || !needsNormalizing(data)) return;
    e.preventDefault();
    insertAtCaret(this.element, normalizeText(data), true);
  }

  /** Clean the range the last edit changed, if it still holds tabs or CRs. Returns whether it did. */
  #normalize(): boolean {
    const el = this.element;
    const edit = normalizeEdit(this.#last, el.value, el.selectionEnd);
    if (!edit) return false;
    el.setRangeText(edit.replacement, edit.start, edit.end, "preserve");
    el.setSelectionRange(edit.caret, edit.caret);
    return true;
  }
}
