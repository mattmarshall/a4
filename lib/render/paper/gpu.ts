/**
 * Where the 3D renderer gets its GPU. The element injects a `GpuProvider`
 * (the browser's by default), so an embedder or a test can supply its own
 * device, and a failure keeps its reason.
 */

export class WebGpuUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebGpuUnavailableError";
  }
}

export interface GpuProvider {
  /** A GPU device. Rejects with `WebGpuUnavailableError`, saying why, when there is none. */
  device(): Promise<GPUDevice>;
  /** Call `listener` once when `device` is lost. */
  onLost(device: GPUDevice, listener: () => void): void;
  /** The texture format a canvas context should use. */
  canvasFormat(): GPUTextureFormat;
}

/**
 * The browser's WebGPU: one device shared by every sheet on the page, created
 * on first use and again after it is lost.
 */
/** The parts of the browser's `navigator.gpu` the provider uses. */
type WebGpu = Pick<GPU, "requestAdapter" | "getPreferredCanvasFormat">;

export function browserGpu(
  gpu: WebGpu | undefined = typeof navigator !== "undefined" ? navigator.gpu : undefined,
): GpuProvider {
  let devicePromise: Promise<GPUDevice> | null = null;
  return {
    device() {
      devicePromise ??= (async () => {
        if (!gpu) throw new WebGpuUnavailableError("This browser doesn’t provide WebGPU.");
        const adapter = await gpu.requestAdapter();
        if (!adapter) throw new WebGpuUnavailableError("WebGPU is present, but no graphics adapter is available.");
        const device = await adapter.requestDevice();
        void device.lost.then(() => {
          devicePromise = null;
        });
        // Development only: let a browser check simulate a lost device.
        if (import.meta.env?.DEV)
          (globalThis as { __a4LoseGpuDevice?: () => void }).__a4LoseGpuDevice = () => device.destroy();
        return device;
      })().catch((error: unknown) => {
        devicePromise = null;
        throw error;
      });
      return devicePromise;
    },
    onLost(device, listener) {
      void device.lost.then(() => listener());
    },
    canvasFormat() {
      if (!gpu) throw new WebGpuUnavailableError("This browser doesn’t provide WebGPU.");
      return gpu.getPreferredCanvasFormat();
    },
  };
}
