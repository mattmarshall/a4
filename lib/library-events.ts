/**
 * Cross-tab library events: what a tab tells the others on the "a4-pages"
 * BroadcastChannel, as the binary encoding of a4.v1.LibraryEvent
 * (proto/a4/v1/library_event.proto).
 */

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  LibraryEventSchema,
  PageSavedSchema,
  PagesChangedSchema,
  type LibraryEvent,
} from "./gen/a4/v1/library_event_pb.js";

export type { LibraryEvent } from "./gen/a4/v1/library_event_pb.js";

export const LIBRARY_CHANNEL = "a4-pages";

/** The page list changed. */
export function pagesChanged(): LibraryEvent {
  return create(LibraryEventSchema, { event: { case: "pagesChanged", value: create(PagesChangedSchema) } });
}

/** The page `name` was saved. */
export function pageSaved(name: string): LibraryEvent {
  return create(LibraryEventSchema, { event: { case: "pageSaved", value: create(PageSavedSchema, { name }) } });
}

export function encodeLibraryEvent(event: LibraryEvent): Uint8Array {
  return toBinary(LibraryEventSchema, event);
}

/**
 * Read a channel message: LibraryEvent bytes, or the bare string earlier
 * versions posted ("" for a list change, otherwise the saved page's name).
 * The string is accepted for one release, so a tab still on the old version
 * keeps refreshing this one during a deploy. Null when the message is
 * neither.
 */
export function decodeLibraryEvent(data: unknown): LibraryEvent | null {
  if (typeof data === "string") return data === "" ? pagesChanged() : pageSaved(data);
  let bytes: Uint8Array;
  if (data instanceof Uint8Array) bytes = data;
  else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
  else return null;
  try {
    return fromBinary(LibraryEventSchema, bytes);
  } catch {
    return null;
  }
}
