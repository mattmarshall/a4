/**
 * The window widths where the workbench layout changes, defined once.
 * JavaScript asks `matchMedia(mediaQuery(name))` (useLayout); CSS writes
 * `@media (--bp-<name>)`, which the build resolves from here (vite.config.ts).
 * Each value is the widest window the breakpoint covers, in CSS px.
 */
export const BREAKPOINTS = {
  /** Medium windows: the top bar tightens so it stays one row. */
  medium: 1359,
  /** Narrow windows: the library and inspector open as drawers over the desk. */
  narrow: 1099,
  /** Small screens: the desk gives up some padding. */
  small: 640,
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

/** The media query for windows up to the breakpoint's width. */
export function mediaQuery(name: Breakpoint): string {
  return `(width <= ${BREAKPOINTS[name]}px)`;
}

/** Replace each `(--bp-<name>)` in CSS with its media query. Unknown names throw. */
export function resolveBreakpoints(css: string): string {
  return css.replace(/\(--bp-([a-z]+)\)/g, (_match, name: string) => {
    if (!Object.hasOwn(BREAKPOINTS, name)) throw new Error(`Unknown breakpoint --bp-${name}`);
    return mediaQuery(name as Breakpoint);
  });
}
