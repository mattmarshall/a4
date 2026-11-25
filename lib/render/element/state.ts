/**
 * The sheet's display state as a pure reducer: attribute changes, orbit
 * drags, and poses (fold frames, fold toggles) in, the next state out. The
 * element keeps one `SheetState` and hands it to its views; `changes` tells
 * a view what it has to redo.
 *
 * Text and selection aren't here: the editor owns them (editor.ts).
 *
 * Framework-free and DOM-free, so Node tests it.
 */

import { assertNever, PRESETS, type LensId, type PageSpec } from "../../page/index.ts";
import { FLAT, type Pose } from "../paper/deform.ts";
import {
  ATTRIBUTES,
  parseLensAttr,
  type A4AttributeName,
  type A4RenderRequest,
  type A4ViewChange,
} from "./contract.ts";

/** The camera: tilt and turn in degrees, and the light's azimuth. */
export interface SheetView {
  readonly tilt: number;
  readonly turn: number;
  readonly light: number;
}

export interface SheetState {
  readonly spec: PageSpec;
  readonly lens: LensId;
  /** The plane shown by `lens="model:<name>"`, or null for a built-in lens. */
  readonly plane: string | null;
  readonly request: A4RenderRequest;
  readonly pose: Pose;
  readonly view: SheetView;
  /** CSS px per mm, or null to fit. */
  readonly zoom: number | null;
  readonly grid: boolean;
  readonly label: string;
  readonly readOnly: boolean;
}

export const INITIAL_STATE: SheetState = {
  spec: PRESETS[ATTRIBUTES.preset.default],
  lens: "ink",
  plane: null,
  request: ATTRIBUTES.render.default,
  pose: FLAT,
  view: { tilt: ATTRIBUTES.tilt.default, turn: ATTRIBUTES.turn.default, light: ATTRIBUTES.light.default },
  zoom: ATTRIBUTES.zoom.default,
  grid: ATTRIBUTES.grid.default,
  label: ATTRIBUTES.label.default,
  readOnly: ATTRIBUTES.readOnly.default,
};

export type SheetAction =
  /** An attribute was set or removed (value null). Always applies, even when unchanged. */
  | { readonly type: "attribute"; readonly name: A4AttributeName; readonly value: string | null }
  /** The user orbited the camera. */
  | { readonly type: "orbit"; readonly view: A4ViewChange }
  /** A fold frame, or the reduced-motion fold toggle. */
  | { readonly type: "pose"; readonly pose: Pose };

function withView(state: SheetState, patch: Partial<SheetView>): SheetState {
  return { ...state, view: { ...state.view, ...patch } };
}

function withPosePatch(state: SheetState, patch: Partial<Pose>): SheetState {
  return { ...state, pose: { ...state.pose, ...patch } };
}

export function reduce(state: SheetState, action: SheetAction): SheetState {
  switch (action.type) {
    case "orbit":
      return withView(state, { tilt: action.view.tilt, turn: action.view.turn });
    case "pose":
      return { ...state, pose: { ...action.pose } };
    case "attribute":
      return applyAttribute(state, action.name, action.value);
    default:
      return assertNever(action);
  }
}

function applyAttribute(state: SheetState, name: A4AttributeName, value: string | null): SheetState {
  switch (name) {
    case "value":
      // The editor owns the text; `value` only seeds it.
      return state;
    case "preset":
      return { ...state, spec: PRESETS[ATTRIBUTES.preset.parse(value)] };
    case "lens": {
      const { lens, plane } = parseLensAttr(value);
      return { ...state, lens, plane };
    }
    case "render":
      return { ...state, request: ATTRIBUTES.render.parse(value) };
    case "fold-bottom":
      return withPosePatch(state, { foldBottom: ATTRIBUTES.foldBottom.parse(value) });
    case "fold-top":
      return withPosePatch(state, { foldTop: ATTRIBUTES.foldTop.parse(value) });
    case "curl":
      return withPosePatch(state, { curl: ATTRIBUTES.curl.parse(value) });
    case "tilt":
      return withView(state, { tilt: ATTRIBUTES.tilt.parse(value) });
    case "turn":
      return withView(state, { turn: ATTRIBUTES.turn.parse(value) });
    case "light":
      return withView(state, { light: ATTRIBUTES.light.parse(value) });
    case "zoom":
      return { ...state, zoom: ATTRIBUTES.zoom.parse(value) };
    case "grid":
      return { ...state, grid: ATTRIBUTES.grid.parse(value) };
    case "label":
      return { ...state, label: ATTRIBUTES.label.parse(value) };
    case "readonly":
      return { ...state, readOnly: ATTRIBUTES.readOnly.parse(value) };
    default:
      return assertNever(name);
  }
}

/** Whether an attribute sets part of the pose (so it stops a fold in progress). */
export function isPoseAttribute(name: A4AttributeName): boolean {
  return name === "fold-bottom" || name === "fold-top" || name === "curl";
}

/** Degrees of tilt and turn per CSS pixel dragged. */
const ORBIT_SPEED = { turn: 0.3, tilt: 0.25 } as const;

/**
 * The camera after dragging (dx, dy) CSS px from `start`: turn wraps into
 * [-180, 180), and tilt stays within the attribute's range.
 */
export function orbit(start: A4ViewChange, dx: number, dy: number): A4ViewChange {
  const turn = ((((start.turn + dx * ORBIT_SPEED.turn + 180) % 360) + 360) % 360) - 180;
  const { min, max } = ATTRIBUTES.tilt;
  const tilt = Math.max(min, Math.min(max, start.tilt + dy * ORBIT_SPEED.tilt));
  return { tilt, turn };
}

/** What a state change makes a view redo. */
export interface StateChanges {
  /** The painted page: preset, lens, plane, or grid. */
  readonly content: boolean;
  /** The camera: tilt, turn, light, or zoom. */
  readonly view: boolean;
  /** The paper's shape. */
  readonly pose: boolean;
  /** The requested rendering. */
  readonly render: boolean;
  /** The accessible name. */
  readonly label: boolean;
  /** Whether the text can be edited. */
  readonly readOnly: boolean;
}

const samePose = (a: Pose, b: Pose) => a.foldBottom === b.foldBottom && a.foldTop === b.foldTop && a.curl === b.curl;
const sameView = (a: SheetView, b: SheetView) => a.tilt === b.tilt && a.turn === b.turn && a.light === b.light;

export function changes(prev: SheetState, next: SheetState): StateChanges {
  return {
    content: prev.spec !== next.spec || prev.lens !== next.lens || prev.plane !== next.plane || prev.grid !== next.grid,
    view: !sameView(prev.view, next.view) || prev.zoom !== next.zoom,
    pose: !samePose(prev.pose, next.pose),
    render: prev.request !== next.request,
    label: prev.label !== next.label,
    readOnly: prev.readOnly !== next.readOnly,
  };
}
