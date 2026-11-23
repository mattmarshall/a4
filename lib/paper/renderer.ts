/**
 * WebGPU renderer for the paper view: a deformable A4 mesh textured with the
 * page, lit by a directional light, with a planar shadow on the desk.
 * Browser-only. Picking uses the same deformation on the CPU (pick.ts).
 */

import { camera, rayFromNdc, type Camera } from "./camera.ts";
import { buildMesh, deformMesh, type PaperMesh, type Pose } from "./deform.ts";
import { raycast, type PaperHit } from "./pick.ts";
import { PAPER_WGSL } from "./shader.ts";

export interface View {
  tilt: number;
  yaw: number;
  /** Light azimuth in degrees around the desk, and elevation above it. */
  lightAzimuth: number;
  lightElevation: number;
}

const SAMPLES = 4;

// WebGPU flag values from the spec (TypeScript's DOM lib types the interfaces
// but doesn't declare these namespaces).
const BUFFER = { COPY_DST: 0x0008, INDEX: 0x0010, VERTEX: 0x0020, UNIFORM: 0x0040 } as const;
const TEXTURE = { COPY_DST: 0x02, TEXTURE_BINDING: 0x04, RENDER_ATTACHMENT: 0x10 } as const;
const STAGE = { VERTEX: 0x1, FRAGMENT: 0x2 } as const;

export class WebGpuUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebGpuUnavailableError";
  }
}

export class PaperRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly #device: GPUDevice;
  readonly #context: GPUCanvasContext;
  readonly #format: GPUTextureFormat;
  readonly #mesh: PaperMesh;
  readonly #vertexBuffer: GPUBuffer;
  readonly #indexBuffer: GPUBuffer;
  readonly #uniforms: GPUBuffer;
  readonly #sampler: GPUSampler;
  readonly #paperPipeline: GPURenderPipeline;
  readonly #shadowPipeline: GPURenderPipeline;
  readonly #bindGroupLayout: GPUBindGroupLayout;
  #pageTexture: GPUTexture | null = null;
  #bindGroup: GPUBindGroup | null = null;
  #msaa: GPUTexture | null = null;
  #depth: GPUTexture | null = null;
  #pose: Pose = { foldBottom: 0, foldTop: 0, curl: 0 };
  #view: View = { tilt: 0, yaw: 0, lightAzimuth: 225, lightElevation: 55 };
  #desk: [number, number, number] = [0.91, 0.9, 0.87];
  #camera: Camera | null = null;
  #positions: Float32Array | null = null;

  private constructor(canvas: HTMLCanvasElement, device: GPUDevice, context: GPUCanvasContext, format: GPUTextureFormat) {
    this.canvas = canvas;
    this.#device = device;
    this.#context = context;
    this.#format = format;
    this.#mesh = buildMesh();

    this.#vertexBuffer = device.createBuffer({
      size: this.#mesh.uvs.byteLength,
      usage: BUFFER.VERTEX | BUFFER.COPY_DST,
    });
    device.queue.writeBuffer(this.#vertexBuffer, 0, this.#mesh.uvs);
    this.#indexBuffer = device.createBuffer({
      size: this.#mesh.indices.byteLength,
      usage: BUFFER.INDEX | BUFFER.COPY_DST,
    });
    device.queue.writeBuffer(this.#indexBuffer, 0, this.#mesh.indices);
    this.#uniforms = device.createBuffer({ size: 128, usage: BUFFER.UNIFORM | BUFFER.COPY_DST });
    this.#sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });

    const module = device.createShaderModule({ code: PAPER_WGSL });
    const vertex = (entryPoint: string): GPUVertexState => ({
      module,
      entryPoint,
      buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }] }],
    });
    const layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: STAGE.VERTEX | STAGE.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: STAGE.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: STAGE.FRAGMENT, sampler: { type: "filtering" } },
      ],
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    this.#paperPipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: vertex("vsPaper"),
      fragment: { module, entryPoint: "fsPaper", targets: [{ format }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
      multisample: { count: SAMPLES },
    });
    this.#shadowPipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: vertex("vsShadow"),
      fragment: {
        module,
        entryPoint: "fsShadow",
        targets: [
          {
            format,
            blend: {
              color: { srcFactor: "one", dstFactor: "one", operation: "min" },
              alpha: { srcFactor: "one", dstFactor: "one", operation: "min" },
            },
          },
        ],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth24plus", depthWriteEnabled: false, depthCompare: "always" },
      multisample: { count: SAMPLES },
    });
    this.#bindGroupLayout = layout;
  }

  static async create(canvas: HTMLCanvasElement): Promise<PaperRenderer> {
    const gpu = typeof navigator !== "undefined" ? navigator.gpu : undefined;
    if (!gpu) throw new WebGpuUnavailableError("This browser doesn’t provide WebGPU.");
    const adapter = await gpu.requestAdapter();
    if (!adapter) throw new WebGpuUnavailableError("WebGPU is present, but no graphics adapter is available.");
    const device = await adapter.requestDevice();
    const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
    if (!context) throw new WebGpuUnavailableError("Couldn’t create a WebGPU canvas context.");
    const format = gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });
    return new PaperRenderer(canvas, device, context, format);
  }

  /** Upload a freshly painted page canvas as the paper texture. */
  setPage(source: HTMLCanvasElement | OffscreenCanvas): void {
    const { width, height } = source;
    if (!this.#pageTexture || this.#pageTexture.width !== width || this.#pageTexture.height !== height) {
      this.#pageTexture?.destroy();
      this.#pageTexture = this.#device.createTexture({
        size: [width, height],
        format: "rgba8unorm",
        usage: TEXTURE.TEXTURE_BINDING | TEXTURE.COPY_DST | TEXTURE.RENDER_ATTACHMENT,
      });
      this.#bindGroup = this.#device.createBindGroup({
        layout: this.#bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.#uniforms } },
          { binding: 1, resource: this.#pageTexture.createView() },
          { binding: 2, resource: this.#sampler },
        ],
      });
    }
    this.#device.queue.copyExternalImageToTexture({ source }, { texture: this.#pageTexture }, [width, height]);
  }

  setPose(pose: Pose): void {
    this.#pose = pose;
    this.#positions = null;
  }

  setView(view: View): void {
    this.#view = view;
  }

  setDeskColor(rgb: [number, number, number]): void {
    this.#desk = rgb;
  }

  /** Match the canvas backing store to its CSS size × devicePixelRatio. */
  resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width === w && this.canvas.height === h && this.#msaa) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.#msaa?.destroy();
    this.#depth?.destroy();
    this.#msaa = this.#device.createTexture({ size: [w, h], format: this.#format, sampleCount: SAMPLES, usage: TEXTURE.RENDER_ATTACHMENT });
    this.#depth = this.#device.createTexture({ size: [w, h], format: "depth24plus", sampleCount: SAMPLES, usage: TEXTURE.RENDER_ATTACHMENT });
  }

  #lightDirection(): [number, number, number] {
    const az = (this.#view.lightAzimuth * Math.PI) / 180;
    const el = (this.#view.lightElevation * Math.PI) / 180;
    return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
  }

  render(): void {
    if (!this.#bindGroup || !this.#msaa || !this.#depth) return;
    const aspect = this.canvas.width / this.canvas.height;
    this.#camera = camera({ tilt: this.#view.tilt, yaw: this.#view.yaw, aspect });
    const data = new Float32Array(32);
    data.set(this.#camera.viewProj, 0);
    data.set([...this.#camera.eye, 1], 16);
    data.set([...this.#lightDirection(), 0], 20);
    data.set([this.#pose.foldBottom, this.#pose.foldTop, this.#pose.curl, 0.22], 24);
    data.set([...this.#desk, 1], 28);
    this.#device.queue.writeBuffer(this.#uniforms, 0, data);

    const encoder = this.#device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.#msaa.createView(),
          resolveTarget: this.#context.getCurrentTexture().createView(),
          clearValue: { r: this.#desk[0], g: this.#desk[1], b: this.#desk[2], a: 1 },
          loadOp: "clear",
          storeOp: "discard",
        },
      ],
      depthStencilAttachment: { view: this.#depth.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "discard" },
    });
    pass.setBindGroup(0, this.#bindGroup);
    pass.setVertexBuffer(0, this.#vertexBuffer);
    pass.setIndexBuffer(this.#indexBuffer, "uint32");
    pass.setPipeline(this.#shadowPipeline);
    pass.drawIndexed(this.#mesh.indices.length);
    pass.setPipeline(this.#paperPipeline);
    pass.drawIndexed(this.#mesh.indices.length);
    pass.end();
    this.#device.queue.submit([encoder.finish()]);
  }

  /** Paper point (mm) under a client-space pointer, or null (desk, back side). */
  pick(clientX: number, clientY: number): PaperHit | null {
    if (!this.#camera) return null;
    const rect = this.canvas.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = 1 - ((clientY - rect.top) / rect.height) * 2;
    this.#positions ??= deformMesh(this.#mesh, this.#pose);
    const { origin, dir } = rayFromNdc(this.#camera, ndcX, ndcY);
    return raycast(this.#mesh, this.#positions, origin, dir);
  }

  destroy(): void {
    this.#pageTexture?.destroy();
    this.#msaa?.destroy();
    this.#depth?.destroy();
    this.#vertexBuffer.destroy();
    this.#indexBuffer.destroy();
    this.#uniforms.destroy();
    this.#context.unconfigure();
    this.#device.destroy();
  }
}
