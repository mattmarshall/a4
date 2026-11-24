/**
 * "Last request wins" per slot. Each request to change a slot takes a ticket;
 * a ticket goes stale as soon as a newer request for the same slot begins.
 * An async open checks its ticket after every await, and drops what it built
 * if it was superseded, so fast mode switches or overlapping opens can't leave
 * a stray session in a slot.
 *
 * Tickets, not a queue: commands such as trash, follow-copy, and reconnect
 * open pages from inside other slot work, which a per-slot queue would
 * deadlock.
 */

export interface Ticket<K extends string = string> {
  readonly key: K;
  /** False once a newer request for the same key has begun. */
  current(): boolean;
}

export class SlotRequests<K extends string> {
  readonly #latest = new Map<K, number>();
  #next = 0;

  begin(key: K): Ticket<K> {
    const n = ++this.#next;
    this.#latest.set(key, n);
    return { key, current: () => this.#latest.get(key) === n };
  }
}
