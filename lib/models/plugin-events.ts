/**
 * Cross-tab plugin events: what a tab tells the others on the "a4-plugins"
 * BroadcastChannel (PLUGIN_CHANNEL), as the binary encoding of
 * a4.v1.PluginEvent (proto/a4/v1/plugin_event.proto).
 */

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { type PluginEvent, PluginChangedSchema, PluginEventSchema } from "../gen/a4/v1/plugin_event_pb.js";

/** The plugin `id` was installed, updated, or removed. */
export function pluginChanged(id: string): PluginEvent {
  return create(PluginEventSchema, { event: { case: "pluginChanged", value: create(PluginChangedSchema, { id }) } });
}

export function encodePluginEvent(event: PluginEvent): Uint8Array {
  return toBinary(PluginEventSchema, event);
}

/**
 * The id of the plugin a channel message says changed, or null when the
 * message isn't a PluginEvent this version understands.
 */
export function changedPluginId(data: unknown): string | null {
  let bytes: Uint8Array;
  if (data instanceof Uint8Array) bytes = data;
  else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
  else return null;
  let event: PluginEvent;
  try {
    event = fromBinary(PluginEventSchema, bytes);
  } catch {
    return null;
  }
  return event.event.case === "pluginChanged" && event.event.value.id !== "" ? event.event.value.id : null;
}
