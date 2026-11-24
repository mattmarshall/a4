/**
 * Rendering: the <a4-sheet> element and its contract (attributes and events),
 * and the paper (deformation, painting, and the WebGPU renderer). The
 * element's code loads on demand: take its types from here, and register it
 * with `defineSheetElement()`. The internal split is refactor-sheet-element's.
 */

export type { A4Plane, A4SheetElement } from "./element/a4-sheet.ts";
export {
  A4_EVENTS,
  ATTRIBUTES,
  modelLens,
  toAttributes,
  type A4Render,
  type A4RenderRequest,
  type A4ViewChange,
  type LensAttr,
  type NumberAttribute,
} from "./element/contract.ts";
export { FLAT, withPose, type Pose } from "./paper/deform.ts";
export { heatFill } from "./paper/heat.ts";

/** Load the element's code and register <a4-sheet>; safe to call more than once. */
export async function defineSheetElement(): Promise<void> {
  const { defineA4Sheet } = await import("./element/a4-sheet.ts");
  defineA4Sheet();
}
