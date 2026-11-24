/**
 * One Fit to page request, outside React, so it keeps running while the
 * Models section is collapsed, the inspector is hidden, or focus mode is on.
 *
 * idle → confirm (the consent dialog) → running → idle, or → failed.
 * Consent is approved only by `send()`, for exactly the text the dialog showed.
 */

import type { ConsentToken } from "./consent.ts";
import type { TransformResult } from "./host.ts";
import { ErrorCode, isModelError } from "./errors.ts";

export type FitJobState<R> =
  | { readonly kind: "idle" }
  | { readonly kind: "confirm"; readonly name: string; readonly ref: R; readonly text: string }
  | {
      readonly kind: "running";
      readonly name: string;
      readonly attempt: number;
      /** The most attempts the host allows, once it reports them. */
      readonly maxAttempts: number | null;
      readonly characters: number;
      readonly note: string | null;
    }
  | { readonly kind: "failed"; readonly message: string };

export interface FitRunOptions {
  consent: ConsentToken;
  signal: AbortSignal;
  onProgress: (progress: { attempt: number; maxAttempts: number; characters: number }) => void;
  onAttempt: (attempt: { attempt: number; maxAttempts: number; rowsUsed: number; fits: boolean }) => void;
}

export interface FitJobDeps<R> {
  /** Approve consent for exactly this text: the dialog's Send (the host owns the token). */
  grant: (text: string) => Promise<ConsentToken> | ConsentToken;
  /** Run the transform. */
  run: (text: string, options: FitRunOptions) => Promise<TransformResult>;
  /** Save the result beside the source; resolves once it's open. */
  onResult: (name: string, result: TransformResult, ref: R) => Promise<void>;
  /** The key was rejected. */
  onAuthFailed?: () => void;
}

export class FitJob<R> {
  readonly #deps: FitJobDeps<R>;
  readonly #listeners = new Set<() => void>();
  #state: FitJobState<R> = { kind: "idle" };
  #abort: AbortController | null = null;

  constructor(deps: FitJobDeps<R>) {
    this.#deps = deps;
  }

  get state(): FitJobState<R> {
    return this.#state;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): FitJobState<R> => this.#state;

  #set(state: FitJobState<R>) {
    this.#state = state;
    for (const listener of this.#listeners) listener();
  }

  /** Open the consent dialog for this page. Ignored while a request runs. */
  ask(page: { name: string; ref: R; text: string }): void {
    if (this.#state.kind === "running" || !page.text.trim()) return;
    this.#set({ kind: "confirm", name: page.name, ref: page.ref, text: page.text });
  }

  /** Close the dialog or clear a failure. */
  dismiss(): void {
    if (this.#state.kind === "confirm" || this.#state.kind === "failed") this.#set({ kind: "idle" });
  }

  cancel(): void {
    this.#abort?.abort();
  }

  /** The dialog's Send: approve consent for the text shown, and run. */
  async send(): Promise<void> {
    const state = this.#state;
    if (state.kind !== "confirm") return;
    const { name, ref, text } = state;
    const controller = new AbortController();
    this.#abort = controller;
    this.#set({ kind: "running", name, attempt: 1, maxAttempts: null, characters: 0, note: null });
    const update = (patch: Partial<Extract<FitJobState<R>, { kind: "running" }>>) => {
      if (this.#state.kind === "running") this.#set({ ...this.#state, ...patch });
    };
    try {
      // The host may still be loading: wait for the approval only when it's pending.
      const approval = this.#deps.grant(text);
      const consent = approval instanceof Promise ? await approval : approval;
      const result = await this.#deps.run(text, {
        consent,
        signal: controller.signal,
        onProgress: ({ attempt, maxAttempts, characters }) => update({ attempt, maxAttempts, characters }),
        onAttempt: ({ attempt, rowsUsed, fits }) => {
          if (!fits)
            update({ note: `Attempt ${attempt} used ${rowsUsed} rows; asking for a shorter version.`, characters: 0 });
        },
      });
      await this.#deps.onResult(name, result, ref);
      this.#set({ kind: "idle" });
    } catch (error) {
      if (isModelError(error, ErrorCode.AUTH)) this.#deps.onAuthFailed?.();
      const message =
        isModelError(error, ErrorCode.CANCELED) || controller.signal.aborted
          ? "Canceled. No page was created."
          : `${error instanceof Error ? error.message : String(error)} No page was created.`;
      this.#set({ kind: "failed", message });
    } finally {
      if (this.#abort === controller) this.#abort = null;
    }
  }
}
