/**
 * One shared GPUDevice per page, so several sheets don't each create a device.
 */

export class WebGpuUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebGpuUnavailableError";
  }
}

let devicePromise: Promise<GPUDevice> | null = null;

export function getGpuDevice(): Promise<GPUDevice> {
  devicePromise ??= (async () => {
    const gpu = typeof navigator !== "undefined" ? navigator.gpu : undefined;
    if (!gpu) throw new WebGpuUnavailableError("This browser doesn’t provide WebGPU.");
    const adapter = await gpu.requestAdapter();
    if (!adapter) throw new WebGpuUnavailableError("WebGPU is present, but no graphics adapter is available.");
    const device = await adapter.requestDevice();
    void device.lost.then(() => {
      devicePromise = null;
    });
    // Development only: let a browser check simulate a lost device.
    if (import.meta.env?.DEV) (globalThis as { __a4LoseGpuDevice?: () => void }).__a4LoseGpuDevice = () => device.destroy();
    return device;
  })().catch((error: unknown) => {
    devicePromise = null;
    throw error;
  });
  return devicePromise;
}
