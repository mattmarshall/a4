/**
 * The 3D renderer's lifecycle as a small state machine, separate from the GPU
 * so Node tests it with fakes:
 *
 *   idle ──ensure──▶ creating{token} ──▶ ready{renderer}
 *                          │                  │ device lost
 *                          ▼                  ▼
 *              unavailable{reason}   idle (once), then unavailable
 *
 * - A creation that finishes after `release()` (the element left the
 *   document) or after a newer `ensure()` is stale: its renderer is destroyed
 *   on arrival.
 * - After a lost device, 3D is recreated once; a second loss gives up.
 * - The reason 3D is unavailable is kept for diagnostics.
 */

export interface Disposable {
  destroy(): void;
  /** Settles when the renderer's GPU device is lost. */
  readonly lost: Promise<unknown>;
}

export type RendererState<R> =
  | { readonly kind: "idle" }
  | { readonly kind: "creating"; readonly token: number }
  | { readonly kind: "ready"; readonly renderer: R }
  | { readonly kind: "unavailable"; readonly reason: string };

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class RendererLifecycle<R extends Disposable> {
  readonly #create: () => Promise<R>;
  readonly #changed: (state: RendererState<R>) => void;
  #state: RendererState<R> = { kind: "idle" };
  #token = 0;
  #recreatedAfterLoss = false;

  /** `changed` is called after every transition except `ensure`'s own move to creating. */
  constructor(create: () => Promise<R>, changed: (state: RendererState<R>) => void) {
    this.#create = create;
    this.#changed = changed;
  }

  get state(): RendererState<R> {
    return this.#state;
  }

  /** The renderer, once ready. */
  get renderer(): R | null {
    return this.#state.kind === "ready" ? this.#state.renderer : null;
  }

  /** Start creating a renderer, unless one is ready, being created, or unavailable. */
  ensure(): void {
    if (this.#state.kind !== "idle") return;
    const token = ++this.#token;
    this.#state = { kind: "creating", token };
    this.#create().then(
      (renderer) => {
        if (this.#state.kind !== "creating" || this.#state.token !== token) {
          renderer.destroy();
          return;
        }
        this.#set({ kind: "ready", renderer });
        void renderer.lost.then(() => this.#lost(renderer));
      },
      (error: unknown) => {
        if (this.#state.kind === "creating" && this.#state.token === token) {
          this.#set({ kind: "unavailable", reason: reasonOf(error) });
        }
      },
    );
  }

  /** Destroy the renderer and drop any creation in progress. Unavailable stays unavailable. */
  release(): void {
    if (this.#state.kind === "ready") this.#state.renderer.destroy();
    this.#token++;
    if (this.#state.kind !== "unavailable") this.#state = { kind: "idle" };
  }

  #lost(renderer: R) {
    if (this.#state.kind !== "ready" || this.#state.renderer !== renderer) return;
    if (this.#recreatedAfterLoss) {
      this.#set({ kind: "unavailable", reason: "The GPU device was lost again after it was recreated." });
      return;
    }
    this.#recreatedAfterLoss = true;
    this.#set({ kind: "idle" });
  }

  #set(state: RendererState<R>) {
    this.#state = state;
    this.#changed(state);
  }
}
