/**
 * The plugin kit: what a third-party plugin bundles to run in A4's sandbox
 * (README, "Third-party plugins"). A plugin's code is one script that calls
 * `servePlugin` once. The host's first message to the worker is an
 * `a4.v1.PluginStart` (its model files and credentials) with the port to
 * serve `SheetModelService` on, in `a4.v1.RpcFrame`s, as the bundled
 * in-browser plugin does.
 *
 * The kit answers Describe with the plugin's own card, so the card the
 * publisher signs and the card the plugin reports are the same JSON.
 */

import { fromBinary, fromJson, type JsonValue } from "@bufbuild/protobuf";
import { type ModelCard, ModelCardSchema } from "../../gen/a4/v1/model_pb.js";
import type { PageSpec, Sheet } from "../../gen/a4/v1/sheet_pb.js";
import { PluginStartSchema } from "../../gen/a4/v1/plugin_pb.js";
import { layoutRows } from "../../page/layout.ts";
import { spanToCells } from "../../tensor/cells.ts";
import { implement, type SheetModelHandlers } from "../client.ts";
import { readTextSheet } from "../sheet-input.ts";
import { servePort } from "../worker-transport.ts";

/** What the host gave the plugin when it started. */
export interface PluginRuntime {
  /** The plugin's own card. */
  readonly card: ModelCard;
  /** A model file's bytes, by the URL its manifest gives it, or null when the host sent none. */
  file(url: string): Uint8Array | null;
  /** A credential the card declares and the author entered, or null. */
  credential(kind: string): string | null;
}

/** The handlers a plugin implements; Describe is the kit's. */
export type PluginHandlers = Partial<Omit<SheetModelHandlers, "describe">>;

/** Where the start message arrives: the worker's global scope. */
export interface StartScope {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

/**
 * Serve a plugin: wait for the host's start message, then answer calls on the
 * port it brought. `card` is the plugin's card as proto3 JSON, the same file
 * `a4 plugin pack --card` signs.
 */
export function servePlugin(
  card: JsonValue,
  handlers: (runtime: PluginRuntime) => PluginHandlers,
  scope: StartScope = self,
): void {
  const ownCard = fromJson(ModelCardSchema, card);
  const onStart = (event: MessageEvent) => {
    const port = event.ports[0];
    if (!port) return;
    scope.removeEventListener("message", onStart);
    const start = fromBinary(PluginStartSchema, new Uint8Array(event.data as ArrayBufferLike));
    const files = new Map(start.files.map((f) => [f.url, f.data]));
    const runtime: PluginRuntime = {
      card: ownCard,
      file: (url) => files.get(url) ?? null,
      credential: (kind) => start.credentials[kind] ?? null,
    };
    servePort(port, implement({ ...handlers(runtime), describe: () => ({ card: ownCard }) }));
  };
  scope.addEventListener("message", onStart);
}

/** A sheet's text and page spec, checked; for a plugin whose card reads the text view. */
export function sheetText(sheet: Sheet | undefined, who: string): { text: string; spec: PageSpec } {
  return readTextSheet(sheet, who);
}

/**
 * A plane for `text` laid out on `spec`: each span's cells hold its value,
 * and every other cell holds 0. The shape matches the grid the host scores.
 */
export function spanPlane(
  text: string,
  spec: Pick<PageSpec, "cols" | "rows">,
  spans: readonly { readonly start: number; readonly end: number; readonly value: number }[],
): { shape: number[]; values: number[] } {
  const rows = layoutRows(text, spec.cols);
  const height = Math.max(spec.rows, rows.length);
  const values = new Float32Array(height * spec.cols);
  for (const span of spans) {
    for (const run of spanToCells(rows, span.start, span.end)) {
      values.fill(span.value, run.row * spec.cols + run.col, run.row * spec.cols + run.col + run.cols);
    }
  }
  return { shape: [height, spec.cols], values: Array.from(values) };
}
