/**
 * The part of the canvas 2D API the painter uses. A real
 * `CanvasRenderingContext2D` (or an offscreen one) satisfies it, and tests
 * pass a recording fake.
 */

export interface Paint2D {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  save(): void;
  restore(): void;
  beginPath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { readonly fontBoundingBoxAscent: number; readonly fontBoundingBoxDescent: number };
}

/** A canvas the painter can size and draw on. */
export interface PaintSurface {
  width: number;
  height: number;
  getContext(kind: "2d"): Paint2D | null;
}
