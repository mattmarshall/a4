/**
 * The element's shadow-root CSS. Its paper, ink, selection, and placeholder
 * colors come from the shared palette, the same tokens the painter uses.
 */

import { PALETTE } from "../palette.ts";

export const DEFAULT_FONT = '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace';

export const SHEET_STYLE = /* css */ `
:host {
  display: block;
  position: relative;
  --_font: var(--a4-font, ${DEFAULT_FONT});
}
:host([hidden]) { display: none; }
.stage { position: relative; overflow: hidden; }
.stage[data-render="3d"] { height: var(--a4-3d-height, 70vh); min-height: 260px; }
.gpu {
  display: none;
  width: 100%;
  height: 100%;
  border-radius: var(--a4-radius, 12px);
  touch-action: none;
}
.stage[data-render="3d"] .gpu { display: block; }
.flat { position: relative; margin: 0 auto; }
.stage[data-render="3d"] .flat {
  position: absolute;
  left: 0;
  top: 0;
  opacity: 0;
  pointer-events: none;
}
.stage[data-render="3d"] .page,
.stage[data-render="3d"] .paper { display: none; }
.paper {
  position: absolute;
  left: 0;
  top: 0;
  background: ${PALETTE.paper};
  box-shadow: var(--a4-shadow, 0 1px 2px #0000000f, 0 8px 28px #0000001c);
}
.page { position: absolute; left: 0; top: 0; display: block; }
.input {
  position: absolute;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  resize: none;
  overflow: hidden;
  outline: none;
  appearance: none;
  background: transparent;
  color: transparent;
  caret-color: ${PALETTE.ink};
  font-family: var(--_font);
  font-weight: 400;
  letter-spacing: 0;
  word-spacing: 0;
  font-kerning: none;
  font-variant-ligatures: none;
  font-feature-settings: "liga" 0, "calt" 0;
  white-space: break-spaces;
  word-break: break-all;
  overflow-wrap: anywhere;
  line-break: anywhere;
  tab-size: 2;
  text-align: left;
}
.input::selection { background: ${PALETTE.selection}; color: transparent; }
.input::placeholder { color: ${PALETTE.faint}; }
.print { display: none; }
@media print {
  :host {
    display: block !important;
    width: 210mm !important;
    height: 297mm !important;
    overflow: hidden;
    break-before: page;
    break-after: page;
    break-inside: avoid;
  }
  .stage { height: 297mm !important; }
  .gpu, .flat { display: none !important; }
  .print {
    display: block;
    position: absolute;
    inset: 0;
    background: #fff;
    color: #000;
    font-family: var(--_font);
  }
  .print div { position: absolute; white-space: pre; }
}
`;
