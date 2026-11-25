/**
 * The <a4-sheet> contract: its tag, attributes, and events, declared once.
 *
 * - `ATTRIBUTES` drives the element's `observedAttributes` and parsing, the
 *   React wrapper's attribute mapping, the /element docs table, the 3D
 *   controls' slider ranges, and the generated JSX types in
 *   `types/a4-sheet.d.ts` (scripts/gen-element-types.ts).
 * - `A4SheetEventMap` types the element's `addEventListener`, and `a4Event`
 *   builds each event with its detail.
 *
 * Framework-free and DOM-free at load, so Node can import it.
 */

import {
  DEFAULT_PRESET,
  isPresetId,
  PRESETS,
  PX_PER_MM_ACTUAL,
  type PresetId,
  isLensId,
  LENS_IDS,
  type LensId,
} from "../../page/index.ts";
import type { Pose } from "../paper/deform.ts";

export const A4_SHEET_TAG = "a4-sheet";

// ---------------------------------------------------------------------------
// Lenses: a built-in lens, or a model lens showing a named plane.

const MODEL_LENS_PREFIX = "model:";

export type ModelLensAttr = `model:${string}`;
/** The `lens` attribute: a built-in lens id, or `model:<plane>`. */
export type LensAttr = LensId | ModelLensAttr;

/** The `lens` value that shows the plane named `plane`. */
export function modelLens(plane: string): ModelLensAttr {
  return `${MODEL_LENS_PREFIX}${plane}`;
}

/** Split a `lens` attribute into the built-in lens and the plane it shows (null for a built-in lens). */
export function parseLensAttr(value: string | null): { lens: LensId; plane: string | null } {
  if (value?.startsWith(MODEL_LENS_PREFIX) && value.length > MODEL_LENS_PREFIX.length) {
    return { lens: "ink", plane: value.slice(MODEL_LENS_PREFIX.length) };
  }
  return { lens: isLensId(value) ? value : "ink", plane: null };
}

// ---------------------------------------------------------------------------
// Attributes

export type A4Render = "3d" | "flat";
export type A4RenderRequest = A4Render | "auto";

interface AttributeBase<T> {
  /** The HTML attribute name. */
  readonly name: string;
  /** Read the attribute (null when absent). Never throws: bad values fall back. */
  parse(value: string | null): T;
  /** The attribute for `value`; null removes it. */
  serialize(value: T): string | null;
  readonly default: T;
  /** The values in words, for the docs table. */
  readonly doc: string;
}

export interface TextAttribute extends AttributeBase<string> {
  readonly kind: "text";
}
export interface ChoiceAttribute<T extends string> extends AttributeBase<T> {
  readonly kind: "choice";
  readonly values: readonly T[];
}
export interface NumberAttribute extends AttributeBase<number> {
  readonly kind: "number";
  readonly min: number;
  readonly max: number;
  /** The slider step in the 3D controls. */
  readonly step: number;
}
export interface FlagAttribute extends AttributeBase<boolean> {
  readonly kind: "flag";
}
export interface LensAttribute extends AttributeBase<LensAttr> {
  readonly kind: "lens";
  /** The built-in lenses; any other value is `model:<plane>`. */
  readonly values: readonly LensId[];
}
export interface ZoomAttribute extends AttributeBase<number | null> {
  readonly kind: "zoom";
  readonly min: number;
  readonly max: number;
}

export type AttributeSpec =
  | TextAttribute
  | ChoiceAttribute<string>
  | NumberAttribute
  | FlagAttribute
  | LensAttribute
  | ZoomAttribute;

function finite(value: string | null): number | null {
  const n = value === null ? Number.NaN : Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function text<const N extends string>(name: N, doc: string): TextAttribute & { readonly name: N } {
  return { kind: "text", name, doc, default: "", parse: (v) => v ?? "", serialize: (v) => v };
}

function choice<T extends string, const N extends string>(
  name: N,
  values: readonly T[],
  fallback: T,
  doc?: string,
): ChoiceAttribute<T> & { readonly name: N } {
  const valid = (v: string | null): v is T => values.some((x) => x === v);
  return {
    kind: "choice",
    name,
    values,
    default: fallback,
    doc: doc ?? values.join(", "),
    parse: (v) => (valid(v) ? v : fallback),
    serialize: (v) => v,
  };
}

/** A number clamped to [min, max]; `unit` is shown in the docs. */
function number<const N extends string>(
  name: N,
  min: number,
  max: number,
  fallback: number,
  step: number,
  unit = "",
): NumberAttribute & { readonly name: N } {
  return {
    kind: "number",
    name,
    min,
    max,
    step,
    default: fallback,
    doc: `${min} to ${max}${unit}`,
    parse: (v) => {
      const n = finite(v);
      return n === null ? fallback : clamp(n, min, max);
    },
    serialize: (v) => String(v),
  };
}

/** An angle in degrees, wrapped into [0, 360): 400 and 40 light the page alike. */
function azimuth<const N extends string>(name: N, fallback: number): NumberAttribute & { readonly name: N } {
  return {
    ...number(name, 0, 360, fallback, 1, "°"),
    doc: "azimuth in degrees (wraps around)",
    parse: (v) => {
      const n = finite(v);
      return n === null ? fallback : ((n % 360) + 360) % 360;
    },
  };
}

const PRESET_IDS = Object.keys(PRESETS).filter(isPresetId);

/** Every <a4-sheet> attribute, keyed by the property name used in code. */
export const ATTRIBUTES = {
  value: text("value", "Initial text (then use the value property)"),
  preset: choice<PresetId, "preset">("preset", PRESET_IDS, DEFAULT_PRESET),
  lens: {
    kind: "lens",
    name: "lens",
    values: LENS_IDS,
    default: "ink",
    doc: `${LENS_IDS.join(", ")}, or model:<name> for a plane`,
    parse: (v) => {
      const { lens, plane } = parseLensAttr(v);
      return plane === null ? lens : modelLens(plane);
    },
    serialize: (v) => v,
  },
  render: choice<A4RenderRequest, "render">(
    "render",
    ["auto", "3d", "flat"],
    "auto",
    "auto (3D if WebGPU is available), 3d, flat",
  ),
  foldBottom: number("fold-bottom", 0, 1, 0, 0.01),
  foldTop: number("fold-top", 0, 1, 0, 0.01),
  curl: number("curl", 0, 1, 0, 0.01),
  tilt: number("tilt", 0, 65, 32, 1, "°"),
  turn: number("turn", -180, 180, 0, 1, "°"),
  light: azimuth("light", 215),
  zoom: {
    kind: "zoom",
    name: "zoom",
    min: 0.5,
    max: 12,
    default: null,
    doc: "CSS px per mm (0.5 to 12), or fit",
    parse: (v) => {
      if (v === null || v === "fit") return null;
      const n = finite(v);
      return n === null ? PX_PER_MM_ACTUAL : clamp(n, 0.5, 12);
    },
    serialize: (v) => (v === null ? "fit" : String(v)),
  },
  grid: {
    kind: "flag",
    name: "grid",
    default: false,
    doc: "boolean: present shows the cell grid",
    parse: (v) => v !== null && v !== "false",
    serialize: (v) => (v ? "" : null),
  },
  label: text("label", "accessible name"),
  readOnly: {
    kind: "flag",
    name: "readonly",
    default: false,
    doc: "boolean: present stops editing; selecting and copying still work",
    parse: (v) => v !== null && v !== "false",
    serialize: (v) => (v ? "" : null),
  },
} as const satisfies Record<string, AttributeSpec>;

export type A4AttributeKey = keyof typeof ATTRIBUTES;
export type A4AttributeName = (typeof ATTRIBUTES)[A4AttributeKey]["name"];
/** Every attribute's parsed value, keyed like `ATTRIBUTES`. */
export type A4Attributes = { [K in A4AttributeKey]: ReturnType<(typeof ATTRIBUTES)[K]["parse"]> };

// Object.keys loses the key type; ATTRIBUTES has no other keys.
const ATTRIBUTE_KEYS = Object.keys(ATTRIBUTES) as A4AttributeKey[];

export const OBSERVED_ATTRIBUTES: readonly A4AttributeName[] = ATTRIBUTE_KEYS.map((key) => ATTRIBUTES[key].name);

/** The table seen per key, so a key's spec and its value type stay paired in generic code. */
const SPECS: { readonly [K in A4AttributeKey]: AttributeBase<A4Attributes[K]> } = ATTRIBUTES;

function serialize<K extends A4AttributeKey>(key: K, value: A4Attributes[K]): string | null {
  return SPECS[key].serialize(value);
}

/** The attributes for `values`, by attribute name; null removes one. Keys left out are not touched. */
export function toAttributes(values: Partial<A4Attributes>): Map<A4AttributeName, string | null> {
  const out = new Map<A4AttributeName, string | null>();
  for (const key of ATTRIBUTE_KEYS) {
    const value = values[key];
    if (value !== undefined) out.set(ATTRIBUTES[key].name, serialize(key, value));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Events

export interface A4ViewChange {
  tilt: number;
  turn: number;
}

/** Events the element dispatches (bubbling and composed), with their details. */
export interface A4SheetEventMap {
  "a4-focus": CustomEvent<null>;
  "a4-render": CustomEvent<A4Render>;
  "a4-viewchange": CustomEvent<A4ViewChange>;
  "a4-posechange": CustomEvent<Pose>;
}

export const A4_EVENTS = {
  focus: "a4-focus",
  render: "a4-render",
  viewChange: "a4-viewchange",
  poseChange: "a4-posechange",
} as const satisfies Record<string, keyof A4SheetEventMap>;

type Detail<K extends keyof A4SheetEventMap> = A4SheetEventMap[K] extends CustomEvent<infer D> ? D : never;

/** A bubbling, composed event of type `type` with its detail. */
export function a4Event<K extends keyof A4SheetEventMap>(type: K, detail: Detail<K>): CustomEvent<Detail<K>> {
  return new CustomEvent(type, { bubbles: true, composed: true, detail });
}
