/** Compressibility: the one async metric, computed off the typing path by the UI. */

/** Shorter text isn't measured (density-analysis, "Compressibility": at least 200 characters). */
const COMPRESSIBILITY_MIN_CHARS = 200;

/** Deflate-compressed size divided by UTF-8 size; null below the minimum length. */
export async function compressibility(text: string): Promise<number | null> {
  if (text.length < COMPRESSIBILITY_MIN_CHARS) return null;
  if (typeof CompressionStream === "undefined") return null;
  const bytes = new TextEncoder().encode(text);
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const compressed = await new Response(stream).arrayBuffer();
  return compressed.byteLength / bytes.byteLength;
}
