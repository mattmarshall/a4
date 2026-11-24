/**
 * WebGPU renderer for the paper view: a deformable A4 mesh textured with the
 * page, lit by a directional light, with a planar shadow on the desk.
 * Browser-only.
 *
 * The paper is deformed on the CPU when the pose changes (deform.ts) and its
 * vertices uploaded; picking reads the same vertices. A new view only
 * rewrites the uniforms, and a new page only the texture.
 */

import { pixelRatio, PIXEL_RATIO_CAP } from "../../page/index.ts";
import { camera, rayFromNdc, type Camera } from "./camera.ts";
import { buildMesh, deformAttributes, FLAT, type PaperMesh, type Pose, VERTEX_FLOATS } from "./deform.ts";
import { raycast, type PaperHit } from "./pick.ts";
import { WebGpuUnavailableError, type GpuProvider } from "./gpu.ts";
import { PAPER_WGSL } from "./shader.ts";
import { lightDirection, packUniforms, UNIFORM_FLOATS } from "./uniforms.ts";

/** How much the paper's shadow darkens the desk. */
const SHADOW = 0.22;

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

export class PaperRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly #device: GPUDevice;
  readonly #context: GPUCanvasContext;
  readonly #format: GPUTextureFormat;
  readonly #mesh: PaperMesh;
  /** Each vertex's uv: fixed. */
  readonly #uvBuffer: GPUBuffer;
  /** Each vertex's deformed position, normal, and crease: rewritten when the pose changes. */
  readonly #shapeBuffer: GPUBuffer;
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
  /** The vertices `#shapeBuffer` holds, for picking. */
  #shape: Float32Array;
  #view: View = { tilt: 0, yaw: 0, lightAzimuth: 225, lightElevation: 55 };
  #desk: [number, number, number] = [0.91, 0.9, 0.87];
  #camera: Camera | null = null;
  #zoom: number | null = null;

  private constructor(
    canvas: HTMLCanvasElement,
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat,
  ) {
    this.canvas = canvas;
    this.#device = device;
    this.#context = context;
    this.#format = format;
    this.#mesh = buildMesh();

    this.#uvBuffer = device.createBuffer({
      size: this.#mesh.uvs.byteLength,
      usage: BUFFER.VERTEX | BUFFER.COPY_DST,
    });
    device.queue.writeBuffer(this.#uvBuffer, 0, this.#mesh.uvs);
    this.#shape = deformAttributes(this.#mesh, FLAT);
    this.#shapeBuffer = device.createBuffer({
      size: this.#shape.byteLength,
      usage: BUFFER.VERTEX | BUFFER.COPY_DST,
    });
    device.queue.writeBuffer(this.#shapeBuffer, 0, this.#shape);
    this.#indexBuffer = device.createBuffer({
      size: this.#mesh.indices.byteLength,
      usage: BUFFER.INDEX | BUFFER.COPY_DST,
    });
    device.queue.writeBuffer(this.#indexBuffer, 0, this.#mesh.indices);
    this.#uniforms = device.createBuffer({ size: UNIFORM_FLOATS * 4, usage: BUFFER.UNIFORM | BUFFER.COPY_DST });
    this.#sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });

    const module = device.createShaderModule({ code: PAPER_WGSL });
    const vertex = (entryPoint: string): GPUVertexState => ({
      module,
      entryPoint,
      buffers: [
        { arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }] },
        {
          arrayStride: VERTEX_FLOATS * 4,
          attributes: [
            { shaderLocation: 1, offset: 0, format: "float32x3" },
            { shaderLocation: 2, offset: 12, format: "float32x3" },
            { shaderLocation: 3, offset: 24, format: "float32" },
          ],
        },
      ],
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

  static async create(canvas: HTMLCanvasElement, gpu: GpuProvider): Promise<PaperRenderer> {
    const device = await gpu.device();
    const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
    if (!context) throw new WebGpuUnavailableError("Couldn’t create a WebGPU canvas context.");
    const format = gpu.canvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });
    const renderer = new PaperRenderer(canvas, device, context, format);
    gpu.onLost(device, renderer.#markLost);
    return renderer;
  }

  #markLost: () => void = () => {};
  readonly #lost = new Promise<void>((resolve) => {
    this.#markLost = resolve;
  });

  /** Settles when the GPU device behind this renderer is lost. */
  get lost(): Promise<unknown> {
    return this.#lost;
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

  /** Deform the paper to `pose` and upload its vertices. */
  setPose(pose: Pose): void {
    this.#shape = deformAttributes(this.#mesh, pose);
    this.#device.queue.writeBuffer(this.#shapeBuffer, 0, this.#shape);
  }

  setView(view: View): void {
    this.#view = view;
  }

  /** CSS px per mm at the sheet, or null to fit. */
  setZoom(pxPerMm: number | null): void {
    this.#zoom = pxPerMm;
  }

  setDeskColor(rgb: [number, number, number]): void {
    this.#desk = rgb;
  }

  /** Match the canvas backing store to its CSS size × devicePixelRatio. Returns whether it changed. */
  resize(): boolean {
    const dpr = pixelRatio(window.devicePixelRatio, PIXEL_RATIO_CAP.gpu);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width === w && this.canvas.height === h && this.#msaa) return false;
    this.canvas.width = w;
    this.canvas.height = h;
    this.#msaa?.destroy();
    this.#depth?.destroy();
    this.#msaa = this.#device.createTexture({
      size: [w, h],
      format: this.#format,
      sampleCount: SAMPLES,
      usage: TEXTURE.RENDER_ATTACHMENT,
    });
    this.#depth = this.#device.createTexture({
      size: [w, h],
      format: "depth24plus",
      sampleCount: SAMPLES,
      usage: TEXTURE.RENDER_ATTACHMENT,
    });
    return true;
  }

  render(): void {
    if (!this.#bindGroup || !this.#msaa || !this.#depth) return;
    const aspect = this.canvas.width / this.canvas.height;
    this.#camera = camera({
      tilt: this.#view.tilt,
      yaw: this.#view.yaw,
      aspect,
      pxPerMm: this.#zoom,
      cssHeight: this.canvas.clientHeight,
    });
    const data = packUniforms({
      viewProj: this.#camera.viewProj,
      eye: this.#camera.eye,
      light: lightDirection(this.#view.lightAzimuth, this.#view.lightElevation),
      shadow: SHADOW,
      desk: this.#desk,
    });
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
      depthStencilAttachment: {
        view: this.#depth.createView(),
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "discard",
      },
    });
    pass.setBindGroup(0, this.#bindGroup);
    pass.setVertexBuffer(0, this.#uvBuffer);
    pass.setVertexBuffer(1, this.#shapeBuffer);
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
    const { origin, dir } = rayFromNdc(this.#camera, ndcX, ndcY);
    return raycast(this.#mesh, this.#shape, origin, dir, VERTEX_FLOATS);
  }

  destroy(): void {
    this.#pageTexture?.destroy();
    this.#msaa?.destroy();
    this.#depth?.destroy();
    this.#uvBuffer.destroy();
    this.#shapeBuffer.destroy();
    this.#indexBuffer.destroy();
    this.#uniforms.destroy();
    this.#context.unconfigure();
    // The device belongs to the GPU provider (shared across sheets); it is not destroyed here.
  }
}
