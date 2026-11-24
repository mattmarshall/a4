/**
 * Rendering: the <a4-sheet> element and its contract (attributes and events),
 * the painter (paint/, by layer), the paper (deformation, picking, and the
 * WebGPU renderer), and the palette they share. The element's code loads on
 * demand: take its types from here, and register it with
 * `defineSheetElement()`.
 */

export type { A4Plane, A4SheetElement } from "./element/a4-sheet.ts";
export {
  A4_EVENTS,
  ATTRIBUTES,
  modelLens,
  toAttributes,
  type A4AttributeName,
  type A4Render,
  type A4RenderRequest,
  type A4ViewChange,
  type LensAttr,
  type NumberAttribute,
} from "./element/contract.ts";
export { FLAT, withPose, type Pose } from "./paper/deform.ts";
export { heatFill } from "./paint/heat.ts";

/** Load the element's code and register <a4-sheet>; safe to call more than once. */
export async function defineSheetElement(): Promise<void> {
  const { defineA4Sheet } = await import("./element/a4-sheet.ts");
  defineA4Sheet();
}
