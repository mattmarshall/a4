/**
 * One poll loop, for the readers that notice changes made outside A4: the
 * served library's page list (LibraryPoller) and the open folder files
 * (FileWatcher). Each timer runs one pass, then sets the next. A pass is
 * skipped while the tab is hidden, after `stop()`, while the last pass is
 * still running, or while there's nothing to poll, when no timer is set
 * either.
 */

import type { Scheduler } from "./session.ts";

export interface PollLoopOptions {
  readonly scheduler: Scheduler;
  readonly intervalMs: number;
  readonly isVisible: () => boolean;
  /** One pass. */
  readonly poll: () => Promise<void>;
  /** Whether there's anything to poll; while false, no pass runs and no timer is set. Defaults to always. */
  readonly active?: () => boolean;
}

export class PollLoop {
  readonly #options: PollLoopOptions;
  #timer: unknown = null;
  #polling = false;
  #stopped = false;

  constructor(options: PollLoopOptions) {
    this.#options = options;
  }

  get stopped(): boolean {
    return this.#stopped;
  }

  #idle(): boolean {
    const { active } = this.#options;
    return active !== undefined && !active();
  }

  /** Set the next timer, unless one is set, the loop stopped, or there's nothing to poll. */
  start(): void {
    const { scheduler, intervalMs } = this.#options;
    if (this.#stopped || this.#timer !== null || this.#idle()) return;
    this.#timer = scheduler.setTimeout(() => {
      this.#timer = null;
      void this.tick().finally(() => this.start());
    }, intervalMs);
  }

  /** One pass now, skipped while hidden, stopped, already polling, or with nothing to poll. */
  async tick(): Promise<void> {
    if (this.#polling || this.#stopped || this.#idle() || !this.#options.isVisible()) return;
    this.#polling = true;
    try {
      await this.#options.poll();
    } finally {
      this.#polling = false;
    }
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer !== null) this.#options.scheduler.clearTimeout(this.#timer);
    this.#timer = null;
  }
}
