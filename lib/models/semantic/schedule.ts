/**
 * When to score a page for a model lens. One schedule serves every slot:
 *
 * - `now(key, text, preset)` scores at once (the lens was just turned on).
 * - `changed(key, text, preset)` scores `delayMs` after the text or preset
 *   stops changing.
 * - A request whose text and preset match the one in flight, or the latest
 *   result, is skipped, so turning the lens on scores once, not twice.
 * - A result is delivered only if it is still the latest request for that
 *   key and its text is still the key's text; stale results are dropped.
 */

import type { Scheduler } from "../../autosave/session.ts";

export interface ScoreScheduleOptions<K extends string, R> {
  scheduler: Scheduler;
  delayMs: number;
  score: (key: K, text: string, preset: string) => Promise<R>;
  onResult: (key: K, result: R, text: string, preset: string) => void;
  onError?: (key: K, error: unknown) => void;
}

interface Slot {
  /** The key's current text and preset, as last reported. */
  text: string;
  preset: string;
  timer: unknown;
  /** The latest request: in flight until `done`. */
  request: { id: number; text: string; preset: string; done: boolean } | null;
}

export class ScoreSchedule<K extends string, R> {
  readonly #options: ScoreScheduleOptions<K, R>;
  readonly #slots = new Map<K, Slot>();
  #nextId = 0;
  #stopped = false;

  constructor(options: ScoreScheduleOptions<K, R>) {
    this.#options = options;
  }

  #slot(key: K, text: string, preset: string): Slot {
    let slot = this.#slots.get(key);
    if (!slot) {
      slot = { text, preset, timer: null, request: null };
      this.#slots.set(key, slot);
    }
    slot.text = text;
    slot.preset = preset;
    return slot;
  }

  /** True when the latest request (running or finished) is for this text and preset. */
  #covered(slot: Slot): boolean {
    return slot.request !== null && slot.request.text === slot.text && slot.request.preset === slot.preset;
  }

  #cancelTimer(slot: Slot) {
    if (slot.timer !== null) this.#options.scheduler.clearTimeout(slot.timer);
    slot.timer = null;
  }

  /** Score now, unless this exact text is already scored or being scored. */
  now(key: K, text: string, preset: string): void {
    this.#stopped = false;
    const slot = this.#slot(key, text, preset);
    this.#cancelTimer(slot);
    if (!this.#covered(slot)) this.#run(key, slot);
  }

  /** The text or preset changed (or may have): score after the pause. */
  changed(key: K, text: string, preset: string): void {
    this.#stopped = false;
    const slot = this.#slot(key, text, preset);
    this.#cancelTimer(slot);
    if (this.#covered(slot)) return;
    slot.timer = this.#options.scheduler.setTimeout(() => {
      slot.timer = null;
      if (!this.#covered(slot)) this.#run(key, slot);
    }, this.#options.delayMs);
  }

  /** The lens was turned off: forget pending work and drop late results. */
  stop(): void {
    this.#stopped = true;
    for (const slot of this.#slots.values()) this.#cancelTimer(slot);
    this.#slots.clear();
  }

  #run(key: K, slot: Slot): void {
    const request = { id: ++this.#nextId, text: slot.text, preset: slot.preset, done: false };
    slot.request = request;
    this.#options.score(key, request.text, request.preset).then(
      (result) => {
        request.done = true;
        if (this.#stopped || this.#slots.get(key) !== slot || slot.request !== request) return;
        if (slot.text !== request.text || slot.preset !== request.preset) return;
        this.#options.onResult(key, result, request.text, request.preset);
      },
      (error) => {
        request.done = true;
        // Let a later change retry this text.
        if (slot.request === request) slot.request = null;
        if (!this.#stopped) this.#options.onError?.(key, error);
      },
    );
  }
}
