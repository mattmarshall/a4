import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESETS, layoutRows, cellAt, pageSpec } from "../../page/index.ts";
import { paintFrame } from "../paint/frame.ts";
import { pageModel } from "../paint/model.ts";
import { FOLD_DURATION, FOLD_TIMELINE, foldPoseAt } from "./animation.ts";
import { camera, projectToNdc, rayFromNdc } from "./camera.ts";
import {
  A4,
  buildMesh,
  CURL_DIR,
  curlLinePoint,
  deform,
  deformMesh,
  FLAT,
  folds,
  withPose,
  type Pose,
} from "./deform.ts";

// The A4 tests, unchanged from before paper sizes: A4 is the paper here.
const PAPER_W = A4.w;
const PAPER_H = A4.h;
const { hingeTop: HINGE_TOP, hingeBottom: HINGE_BOTTOM } = folds(A4);
import { caretCell, caretOffset, raycast } from "./pick.ts";

const T = PRESETS.terminal;
const POSES: Record<string, Pose> = {
  flat: FLAT,
  "half fold bottom": { foldBottom: 0.5, foldTop: 0, curl: 0 },
  "full fold bottom": { foldBottom: 1, foldTop: 0, curl: 0 },
  "full letter fold": { foldBottom: 1, foldTop: 1, curl: 0 },
  "mid letter fold": { foldBottom: 0.8, foldTop: 0.35, curl: 0 },
  "curl 0.5": { foldBottom: 0, foldTop: 0, curl: 0.5 },
  "curl 1": { foldBottom: 0, foldTop: 0, curl: 1 },
};

const at = (x: number, y: number, pose: Pose) => deform(x, y, pose, A4).world;
const diff = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
const len = (a: number[]) => Math.hypot(...a);
const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);

test("every pose is an isometry: the surface metric stays the identity within 0.5%", () => {
  const e = 0.01;
  for (const [label, pose] of Object.entries(POSES)) {
    for (let x = 1; x < PAPER_W; x += 7.3) {
      for (let y = 1; y < PAPER_H; y += 4.1) {
        const dx = diff(at(x + e, y, pose), at(x - e, y, pose)).map((v) => v / (2 * e));
        const dy = diff(at(x, y + e, pose), at(x, y - e, pose)).map((v) => v / (2 * e));
        assert.ok(Math.abs(len(dx) - 1) < 0.005, `${label} |∂x| at (${x}, ${y}) = ${len(dx)}`);
        assert.ok(Math.abs(len(dy) - 1) < 0.005, `${label} |∂y| at (${x}, ${y}) = ${len(dy)}`);
        assert.ok(Math.abs(dot(dx, dy)) < 0.005, `${label} shear at (${x}, ${y}) = ${dot(dx, dy)}`);
      }
    }
  }
});

function surfaceLength(path: (t: number) => number[], length: number): number {
  let total = 0;
  let prev = path(0);
  for (let t = 0.25; t <= length; t += 0.25) {
    const p = path(t);
    total += len(diff(p, prev));
    prev = p;
  }
  return total;
}

test("a fully letter-folded sheet is still 297 mm top to bottom along its surface", () => {
  const pose = POSES["full letter fold"];
  const total = surfaceLength((y) => at(105, y, pose), PAPER_H);
  assert.ok(Math.abs(total - PAPER_H) / PAPER_H < 0.005, `length ${total}`);
});

test("a fully curled sheet is still 210 mm across along its surface", () => {
  const pose = POSES["curl 1"];
  for (const y of [250, 280, 296]) {
    const total = surfaceLength((x) => at(x, y, pose), PAPER_W);
    assert.ok(Math.abs(total - PAPER_W) / PAPER_W < 0.005, `row ${y}: ${total}`);
  }
});

test("fully folded: the sheet covers one third and panels never pass through each other", () => {
  const pose = POSES["full letter fold"];
  const zs: number[] = [];
  const bottom: number[][] = [];
  const top: number[][] = [];
  for (let x = 0; x <= PAPER_W; x += 15) {
    for (let y = 0; y <= PAPER_H; y += 3) {
      const p = at(x, y, pose);
      zs.push(p[2] + PAPER_H / 2);
      if (y > HINGE_BOTTOM + 6) bottom.push(p);
      if (y < HINGE_TOP - 12) top.push(p);
      // Flat parts of folded panels rest above the middle third (height > 0).
      if (y > HINGE_BOTTOM + 6 || y < HINGE_TOP - 12)
        assert.ok(p[1] > 2.5, `panel point (${x}, ${y}) at height ${p[1]}`);
    }
  }
  assert.ok(Math.max(...zs) - Math.min(...zs) <= PAPER_H / 3 + 8, "footprint is about one third");
  let closest = Infinity;
  for (const b of bottom) for (const t of top) closest = Math.min(closest, len(diff(b, t)));
  assert.ok(closest > 1, `top and bottom panels come within ${closest} mm`);
});

test("the curl only moves points past its line, and lifts the corner", () => {
  const pose = POSES["curl 0.5"];
  const [lx, ly] = curlLinePoint(0.5, A4);
  for (let x = 0; x <= PAPER_W; x += 10) {
    for (let y = 0; y <= PAPER_H; y += 10) {
      const s = (x - lx) * CURL_DIR[0] + (y - ly) * CURL_DIR[1];
      if (s <= 0) assert.deepEqual(at(x, y, pose), at(x, y, FLAT), `(${x}, ${y}) moved`);
    }
  }
  assert.ok(at(PAPER_W, PAPER_H, pose)[1] > 5, "corner lifts off the desk");
  assert.equal(at(0, 0, pose)[1], 0, "top-left stays flat");
});

test("curl and fold are exclusive", () => {
  assert.deepEqual(withPose({ foldBottom: 1, foldTop: 0.5, curl: 0 }, { curl: 0.3 }), {
    foldBottom: 0,
    foldTop: 0,
    curl: 0.3,
  });
  assert.deepEqual(withPose({ foldBottom: 0, foldTop: 0, curl: 0.6 }, { foldTop: 0.2 }), {
    foldBottom: 0,
    foldTop: 0.2,
    curl: 0,
  });
});

const TEXT = Array.from({ length: 12 }, (_, i) => `Row ${i} ${"abcdefghij".repeat(6)}`).join("\n");
const ROWS = layoutRows(TEXT, T.cols);

function centerOf(row: number, col: number): [number, number] {
  return [T.marginX + (col + 0.5) * T.cellW, T.marginY + (row + 0.5) * T.cellH];
}

test("a ray through a cell on a curled, tilted sheet picks that cell", () => {
  const mesh = buildMesh();
  for (const [pose, tilt, yaw] of [
    [POSES["curl 0.5"], 40, 15],
    [POSES["mid letter fold"], 25, -20],
    [FLAT, 0, 0],
  ] as const) {
    const positions = deformMesh(mesh, pose, A4);
    const cam = camera({ paper: A4, tilt, yaw, aspect: 0.8 });
    for (const [row, col] of [
      [3, 10],
      [0, 0],
      [11, 40],
    ]) {
      const [x, y] = centerOf(row, col);
      const [ndcX, ndcY] = projectToNdc(cam, at(x, y, pose));
      const { origin, dir } = rayFromNdc(cam, ndcX, ndcY);
      const hit = raycast(mesh, positions, origin, dir, A4);
      assert.ok(hit, `no hit for row ${row} col ${col} (tilt ${tilt})`);
      assert.deepEqual(cellAt(hit.x, hit.y, T), { row, col });
      assert.equal(caretOffset(ROWS, TEXT.length, row, col), ROWS[row].start + col);
    }
  }
});

test("cells on the curled corner itself are picked exactly", () => {
  const mesh = buildMesh();
  const pose = POSES["curl 0.5"];
  const positions = deformMesh(mesh, pose, A4);
  // The roll's outer surface (the back of the paper) faces the corner, so the
  // printed, rising part of the curl is only visible looking into the roll
  // from the opposite (top-left) side.
  const cam = camera({ paper: A4, tilt: 55, yaw: -140, aspect: 0.8 });
  const [lx, ly] = curlLinePoint(pose.curl, A4);
  let tested = 0;
  for (let row = 40; row < T.rows; row += 2) {
    for (let col = 50; col < T.cols; col += 3) {
      const [x, y] = centerOf(row, col);
      const s = (x - lx) * CURL_DIR[0] + (y - ly) * CURL_DIR[1];
      if (s < 6 || s > 20) continue; // on the rising part of the curl, still facing up
      const [ndcX, ndcY] = projectToNdc(cam, at(x, y, pose));
      const { origin, dir } = rayFromNdc(cam, ndcX, ndcY);
      const hit = raycast(mesh, positions, origin, dir, A4);
      assert.ok(hit, `no hit on the curl at row ${row} col ${col}`);
      assert.deepEqual(cellAt(hit.x, hit.y, T), { row, col });
      tested++;
    }
  }
  assert.ok(tested >= 5, `only ${tested} curled cells tested`);
});

test("from the front, the roll hides the curl's printed side, so it is not pickable", () => {
  const mesh = buildMesh();
  const pose = POSES["curl 0.5"];
  const positions = deformMesh(mesh, pose, A4);
  const cam = camera({ paper: A4, tilt: 35, yaw: 10, aspect: 0.8 });
  const [lx, ly] = curlLinePoint(pose.curl, A4);
  const [x, y] = [lx + CURL_DIR[0] * 12, ly + CURL_DIR[1] * 12];
  const [ndcX, ndcY] = projectToNdc(cam, at(x, y, pose));
  const { origin, dir } = rayFromNdc(cam, ndcX, ndcY);
  assert.equal(raycast(mesh, positions, origin, dir, A4), null);
});

test("the back of a folded panel and the desk are not pickable", () => {
  const mesh = buildMesh();
  const pose = POSES["full letter fold"];
  const positions = deformMesh(mesh, pose, A4);
  const cam = camera({ paper: A4, tilt: 0, yaw: 0, aspect: 0.8 });
  // Looking straight down at the folded letter shows the back of the top panel.
  const [ndcX, ndcY] = projectToNdc(cam, [0, 6, 0]);
  const down = rayFromNdc(cam, ndcX, ndcY);
  assert.equal(raycast(mesh, positions, down.origin, down.dir, A4), null);
  // A ray toward the desk beside the sheet misses.
  const [dx, dy] = projectToNdc(cam, [PAPER_W, 0, 0]);
  const desk = rayFromNdc(cam, dx, dy);
  assert.equal(raycast(mesh, deformMesh(mesh, FLAT, A4), desk.origin, desk.dir, A4), null);
});

test("cells, margins, and caret offsets", () => {
  assert.equal(cellAt(T.marginX - 1, T.marginY + 1, T), null);
  assert.deepEqual(cellAt(T.marginX + 0.1, T.marginY + 0.1, T), { row: 0, col: 0 });
  // A short row: clicking past its end puts the caret at the row's end.
  const rows = layoutRows("ab\ncd", T.cols);
  assert.equal(caretOffset(rows, 5, 0, 30), 2);
  assert.equal(caretOffset(rows, 5, 1, 1), 4);
  assert.equal(caretOffset(rows, 5, 9, 0), 5);
  // Caret at a wrap boundary sits at the start of the next row.
  const wrapped = layoutRows("x".repeat(100), T.cols);
  assert.deepEqual(caretCell(wrapped, 80), { row: 1, col: 0 });
  assert.deepEqual(caretCell(wrapped, 100), { row: 1, col: 20 });
  assert.deepEqual(caretCell(rows, 2), { row: 0, col: 2 });
});

test("the fold animation: bottom up, top down, hold, unfold, end flat", () => {
  const { bottom, top, hold } = FOLD_TIMELINE;
  assert.deepEqual(foldPoseAt(0), FLAT);
  const early = foldPoseAt(bottom * 0.5);
  assert.ok(early.foldBottom > 0.3 && early.foldBottom < 0.7 && early.foldTop === 0);
  const mid = foldPoseAt(bottom + top * 0.5);
  assert.ok(mid.foldBottom === 1 && mid.foldTop > 0.3 && mid.foldTop < 0.7);
  assert.deepEqual(foldPoseAt(bottom + top + hold / 2), { foldBottom: 1, foldTop: 1, curl: 0 });
  const unfolding = foldPoseAt(bottom + top + hold + top * 0.5);
  assert.ok(unfolding.foldBottom === 1 && unfolding.foldTop < 0.7);
  assert.deepEqual(foldPoseAt(FOLD_DURATION), FLAT);
  assert.deepEqual(foldPoseAt(FOLD_DURATION + 5), FLAT);
  // Monotonic in each phase: no jumps between samples 10 ms apart.
  let prev = foldPoseAt(0);
  for (let t = 0.01; t <= FOLD_DURATION; t += 0.01) {
    const p = foldPoseAt(t);
    assert.ok(
      Math.abs(p.foldBottom - prev.foldBottom) < 0.05 && Math.abs(p.foldTop - prev.foldTop) < 0.05,
      `jump at ${t}`,
    );
    prev = p;
  }
});

test("camera zoom: an untilted sheet spans 210 × pxPerMm CSS px", async () => {
  const cssHeight = 800;
  const aspect = 1.2;
  const cssWidth = cssHeight * aspect;
  for (const pxPerMm of [2, 3.7795, 5]) {
    const cam = camera({ paper: A4, tilt: 0, yaw: 0, aspect, pxPerMm, cssHeight });
    const [l] = projectToNdc(cam, [-PAPER_W / 2, 0, 0]);
    const [r] = projectToNdc(cam, [PAPER_W / 2, 0, 0]);
    const widthPx = ((r - l) / 2) * cssWidth;
    assert.ok(Math.abs(widthPx - PAPER_W * pxPerMm) / (PAPER_W * pxPerMm) < 0.02, `${pxPerMm}: ${widthPx}`);
  }
});

test("the uploaded vertices: the same positions as picking, with unit printed-side normals", async () => {
  const { deformAttributes, VERTEX_FLOATS } = await import("./deform.ts");
  const mesh = buildMesh(24, 40);
  for (const [label, pose] of Object.entries(POSES)) {
    const attrs = deformAttributes(mesh, pose, A4);
    const positions = deformMesh(mesh, pose, A4);
    assert.equal(attrs.length, (positions.length / 3) * VERTEX_FLOATS);
    for (let i = 0; i < positions.length / 3; i++) {
      const o = i * VERTEX_FLOATS;
      for (let c = 0; c < 3; c++) {
        assert.ok(Math.abs((attrs[o + c] ?? 0) - (positions[i * 3 + c] ?? 0)) < 1e-4, `${label} vertex ${i}`);
      }
      const n = Math.hypot(attrs[o + 3] ?? 0, attrs[o + 4] ?? 0, attrs[o + 5] ?? 0);
      assert.ok(Math.abs(n - 1) < 1e-5, `${label} normal ${i} has length ${n}`);
    }
  }
});

test("normals: up on flat paper, down on a panel folded over, and creases shade", async () => {
  const { deformAttributes, VERTEX_FLOATS } = await import("./deform.ts");
  const mesh = buildMesh(24, 40);
  const vertex = (attrs: Float32Array, u: number, v: number) => {
    const i = Math.round(v * mesh.ny) * (mesh.nx + 1) + Math.round(u * mesh.nx);
    const o = i * VERTEX_FLOATS;
    return { normalY: attrs[o + 4] ?? 0, crease: attrs[o + 6] ?? 0 };
  };
  const flat = deformAttributes(mesh, FLAT, A4);
  for (let i = 0; i < flat.length; i += VERTEX_FLOATS) {
    assert.ok(Math.abs((flat[i + 4] ?? 0) - 1) < 1e-6);
    assert.equal(flat[i + 6], 0);
  }
  const folded = deformAttributes(mesh, { foldBottom: 1, foldTop: 0, curl: 0 }, A4);
  assert.ok(vertex(folded, 0.5, 0.95).normalY < -0.99, "the bottom third, folded over, faces the desk");
  assert.ok(vertex(folded, 0.5, 0.3).normalY > 0.99, "the top stays face up");
  const creased = [...Array(mesh.ny + 1).keys()].some((j) => vertex(folded, 0.5, j / mesh.ny).crease === 1);
  assert.ok(creased, "vertices on the crease arc are shaded");
});

// ---------------------------------------------------------------------------
// Down the fold ladder: the same paper physics on A5 and A6.

const LADDER = [
  { label: "A5", paper: { w: 148, h: 210 }, spec: pageSpec("terminal", "a5"), hinges: [70, 140] },
  { label: "A6", paper: { w: 105, h: 148 }, spec: pageSpec("terminal", "a6"), hinges: [148 / 3, (2 * 148) / 3] },
] as const;

test("A5 and A6: every pose is an isometry within 0.5%", () => {
  const e = 0.01;
  for (const { label, paper } of LADDER) {
    for (const [name, pose] of Object.entries(POSES)) {
      for (let x = 1; x < paper.w; x += 6.1) {
        for (let y = 1; y < paper.h; y += 3.7) {
          const p = deform(x, y, pose, paper).world;
          const dx = diff(deform(x + e, y, pose, paper).world, p);
          const dy = diff(deform(x, y + e, pose, paper).world, p);
          assert.ok(Math.abs(len(dx) / e - 1) < 0.005, `${label} ${name} x-stretch at (${x}, ${y})`);
          assert.ok(Math.abs(len(dy) / e - 1) < 0.005, `${label} ${name} y-stretch at (${x}, ${y})`);
          assert.ok(Math.abs(dot(dx, dy)) / (e * e) < 0.005, `${label} ${name} shear at (${x}, ${y})`);
        }
      }
    }
  }
});

test("A5 and A6: the letter fold creases at thirds of the sheet, and panels never intersect", () => {
  for (const { label, paper, hinges } of LADDER) {
    const { hingeTop, hingeBottom } = folds(paper);
    assert.ok(Math.abs(hingeTop - hinges[0]) < 1e-9 && Math.abs(hingeBottom - hinges[1]) < 1e-9, label);
    const pose = POSES["full letter fold"];
    const zs: number[] = [];
    const bottom: number[][] = [];
    const top: number[][] = [];
    const k = paper.w / A4.w;
    for (let x = 0; x <= paper.w; x += 7) {
      for (let y = 0; y <= paper.h; y += 1.5) {
        const p = deform(x, y, pose, paper).world;
        zs.push(p[2] + paper.h / 2);
        if (y > hingeBottom + 6 * k) bottom.push(p);
        if (y < hingeTop - 12 * k) top.push(p);
        if (y > hingeBottom + 6 * k || y < hingeTop - 12 * k) assert.ok(p[1] > 2.5 * k, `${label} (${x}, ${y})`);
      }
    }
    assert.ok(Math.max(...zs) - Math.min(...zs) <= paper.h / 3 + 8 * k, `${label} footprint is about one third`);
    let closest = Infinity;
    for (const b of bottom) for (const t of top) closest = Math.min(closest, len(diff(b, t)));
    assert.ok(closest > k, `${label}: top and bottom panels come within ${closest} mm`);
    // The A4 fold is unchanged: hinges at 99 and 198.
    assert.deepEqual([folds(A4).hingeTop, folds(A4).hingeBottom], [99, 198]);
  }
});

test("A6: a ray through the last row's first cell picks row 29", () => {
  const { paper, spec } = LADDER[1];
  const mesh = buildMesh();
  for (const [pose, tilt, yaw] of [
    [FLAT, 0, 0],
    // Tilted, with the opposite corner curled (a folded bottom third shows its back).
    [POSES["curl 0.5"], 40, 15],
  ] as const) {
    const positions = deformMesh(mesh, pose, paper);
    const cam = camera({ paper, tilt, yaw, aspect: 0.8 });
    const row = spec.rows - 1;
    const x = spec.marginX + spec.cellW / 2;
    const y = spec.marginY + (row + 0.5) * spec.cellH;
    const [ndcX, ndcY] = projectToNdc(cam, deform(x, y, pose, paper).world);
    const { origin, dir } = rayFromNdc(cam, ndcX, ndcY);
    const hit = raycast(mesh, positions, origin, dir, paper);
    assert.ok(hit, `no hit (tilt ${tilt})`);
    assert.deepEqual(cellAt(hit.x, hit.y, spec), { row: 28, col: 0 }, "row 29 of 29, counting from 1");
  }
});

test("the paint texture has its paper's shape", () => {
  for (const spec of [PRESETS.terminal, ...LADDER.map((l) => l.spec)]) {
    const frame = paintFrame(pageModel("Hello.", spec, "ink"), {
      fontFamily: "monospace",
      pxPerMm: 6,
      selection: { start: 0, end: 0, focused: false },
      overflow: false,
      grid: false,
      chrome: "texture",
    });
    assert.ok(Math.abs(frame.height / frame.width - spec.paperH / spec.paperW) < 0.01, spec.paper);
    assert.equal(frame.width, Math.round(spec.paperW * 6));
  }
});
