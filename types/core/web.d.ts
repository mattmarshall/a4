/**
 * The web-standard globals the pure core may use (tsconfig.core.json: the
 * page, the analysis, and archives). Browsers, Node, and Workers all provide
 * them (the WinterTC minimum common API). Nothing else from the DOM or Node
 * is declared, so the core can't reach for `document`, `window`,
 * `navigator`, the file system, or `process`.
 *
 * Only the members the core calls are declared. The main tsconfig excludes
 * this file: there, the DOM library declares the full APIs.
 */

declare class TextEncoder {
  encode(input?: string): Uint8Array<ArrayBuffer>;
}

declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
  decode(input?: ArrayBufferView | ArrayBuffer): string;
}

type BlobPart = ArrayBufferView<ArrayBuffer> | ArrayBuffer | string;

interface WritableStream<W = unknown> {
  readonly locked: boolean;
}

interface ReadableStreamDefaultReader<R> {
  read(): Promise<{ done: true; value?: undefined } | { done: false; value: R }>;
  cancel(reason?: unknown): Promise<void>;
}

interface ReadableStream<R = unknown> {
  pipeThrough<T>(transform: { readable: ReadableStream<T>; writable: WritableStream<R> }): ReadableStream<T>;
  getReader(): ReadableStreamDefaultReader<R>;
}

declare class Blob {
  constructor(parts?: BlobPart[]);
  readonly size: number;
  stream(): ReadableStream<Uint8Array<ArrayBuffer>>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

declare class Response {
  constructor(body?: ReadableStream<Uint8Array<ArrayBuffer>> | Blob | null);
  arrayBuffer(): Promise<ArrayBuffer>;
}

type CompressionFormat = "deflate" | "deflate-raw" | "gzip";

declare class CompressionStream {
  constructor(format: CompressionFormat);
  readonly readable: ReadableStream<Uint8Array<ArrayBuffer>>;
  readonly writable: WritableStream<BufferSource>;
}

declare class DecompressionStream {
  constructor(format: CompressionFormat);
  readonly readable: ReadableStream<Uint8Array<ArrayBuffer>>;
  readonly writable: WritableStream<BufferSource>;
}

type BufferSource = ArrayBufferView<ArrayBuffer> | ArrayBuffer;

/** Base64 for binary strings (one character per byte), as the platform's byte helpers use it. */
declare function btoa(data: string): string;
declare function atob(data: string): string;
