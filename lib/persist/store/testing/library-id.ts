/**
 * Test-only: a library id from text, checked as `isLibraryId` checks the id
 * a server sends, so tests make ids without a cast.
 */

import { isLibraryId, type LibraryId } from "../wire.ts";

export function libraryIdOf(text: string): LibraryId {
  if (!isLibraryId(text)) throw new Error(`“${text}” isn’t a library id.`);
  return text;
}
