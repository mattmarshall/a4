/** The URL fragment's links (README, "Share links" and "Served library"). */

/**
 * Remove the fragment from the address bar without reloading or adding a
 * history entry, so a token or a shared page doesn't stay there or in the
 * history.
 */
export function clearFragment(): void {
  if (window.location.hash) {
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
  }
}
