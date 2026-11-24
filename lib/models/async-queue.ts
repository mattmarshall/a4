/**
 * A queue one producer pushes into and one consumer drains as an async
 * iterable: the items in order, then the end, or an error after the items
 * already pushed. Used by the worker transport (a call's reply stream) and the
 * Semantic repetition plugin (download progress).
 */

export class AsyncQueue<T> {
  readonly #items: T[] = [];
  #done = false;
  #failure: { readonly error: unknown } | null = null;
  #wake: (() => void) | null = null;

  /** Add an item; ignored once the queue has ended. */
  push(item: T): void {
    if (this.#done) return;
    this.#items.push(item);
    this.#wake?.();
  }

  /** No more items: the consumer finishes after draining. */
  end(): void {
    this.#done = true;
    this.#wake?.();
  }

  /** End with an error: the consumer throws it after draining. Ignored once ended. */
  fail(error: unknown): void {
    if (this.#done) return;
    this.#failure = { error };
    this.#done = true;
    this.#wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    for (;;) {
      if (this.#items.length) {
        yield this.#items.shift() as T;
        continue;
      }
      if (this.#failure) throw this.#failure.error;
      if (this.#done) return;
      await new Promise<void>((resolve) => (this.#wake = resolve));
      this.#wake = null;
    }
  }
}
