/**
 * Byte helpers the layers share, over the web APIs the browser, Workers, and
 * Node all have:
 *
 * - a byte stream read to the end, up to a limit;
 * - raw DEFLATE both ways (CompressionStream), inflating up to a limit;
 * - base64, base64url, and hex;
 * - byte equality.
 *
 * Callers turn the results into their own errors: a zip entry that inflates
 * past its size, a share link that holds too much, a download larger than
 * its manifest says.
 */

/**
 * Read `stream` to the end, or stop once it has given more than `limit`
 * bytes: then it is cancelled and the result is null. `onChunk` sees the
 * total after each chunk (for progress). The stream's own errors propagate.
 */
export async function readCapped(
  stream: ReadableStream<Uint8Array>,
  limit: number | bigint,
  onChunk?: (total: number) => void,
): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (BigInt(total) > BigInt(limit)) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
    onChunk?.(total);
  }
  return concat(chunks, total);
}

function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** Whether this runtime can deflate and inflate (CompressionStream and DecompressionStream). */
export function canCompress(): boolean {
  return typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";
}

function streamOf(bytes: Uint8Array) {
  return new Blob([new Uint8Array(bytes)]).stream();
}

/** Compress `bytes` as raw DEFLATE. Check `canCompress()` first. */
export async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = streamOf(bytes).pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Inflate raw DEFLATE, reading at most `limit` bytes: null past it. Throws
 * when `bytes` isn't valid DEFLATE. Check `canCompress()` first.
 */
export function inflateRaw(bytes: Uint8Array, limit: number): Promise<Uint8Array | null> {
  return readCapped(streamOf(bytes).pipeThrough(new DecompressionStream("deflate-raw")), limit);
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Base64 to bytes, or null for text that isn't base64. */
export function fromBase64(text: string): Uint8Array | null {
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    return null;
  }
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Base64url without padding (RFC 4648 §5), as links and tokens use it. */
export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Unpadded base64url to bytes, or null for text that isn't base64url. */
export function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  return fromBase64(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
}

/** Lowercase hex, two digits a byte. */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
