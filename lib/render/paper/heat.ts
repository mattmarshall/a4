/**
 * The model-lens tint: one violet whose opacity is proportional to a cell's
 * value. Used by the painter and by UI swatches, so they always match.
 */

/** The strongest model-lens tint, at a value of 1. */
export const HEAT_RGB = "109, 40, 217";
export const HEAT_MAX_ALPHA = 0.5;

/** Fill style for a model-lens value in [0, 1], or null for no tint. */
export function heatFill(value: number): string | null {
  const v = Math.min(1, Math.max(0, value));
  if (!(v > 0)) return null;
  return `rgba(${HEAT_RGB}, ${(HEAT_MAX_ALPHA * v).toFixed(4)})`;
}
