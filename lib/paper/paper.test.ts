import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESETS } from "../page-spec.ts";
import { layoutRows } from "../text.ts";
import { FOLD_DURATION, FOLD_TIMELINE, foldPoseAt } from "./animation.ts";
import { camera, projectToNdc, rayFromNdc } from "./camera.ts";
import {
  buildMesh,
  CURL_DIR,
  curlLinePoint,
  deform,
  deformMesh,
  FLAT,
  HINGE_BOTTOM,
  HINGE_TOP,
  PAPER_H,
  PAPER_W,
  withPose,
  type Pose,
} from "./deform.ts";
import { caretCell, caretOffset, cellAt, raycast } from "./pick.ts";

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

const at = (x: number, y: number, pose: Pose) => deform(x, y, pose).world;
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
      if (y > HINGE_BOTTOM + 6 || y < HINGE_TOP - 12) assert.ok(p[1] > 2.5, `panel point (${x}, ${y}) at height ${p[1]}`);
    }
  }
  assert.ok(Math.max(...zs) - Math.min(...zs) <= PAPER_H / 3 + 8, "footprint is about one third");
  let closest = Infinity;
  for (const b of bottom) for (const t of top) closest = Math.min(closest, len(diff(b, t)));
  assert.ok(closest > 1, `top and bottom panels come within ${closest} mm`);
});

test("the curl only moves points past its line, and lifts the corner", () => {
  const pose = POSES["curl 0.5"];
  const [lx, ly] = curlLinePoint(0.5);
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
  assert.deepEqual(withPose({ foldBottom: 1, foldTop: 0.5, curl: 0 }, { curl: 0.3 }), { foldBottom: 0, foldTop: 0, curl: 0.3 });
  assert.deepEqual(withPose({ foldBottom: 0, foldTop: 0, curl: 0.6 }, { foldTop: 0.2 }), { foldBottom: 0, foldTop: 0.2, curl: 0 });
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
    const positions = deformMesh(mesh, pose);
    const cam = camera({ tilt, yaw, aspect: 0.8 });
    for (const [row, col] of [
      [3, 10],
      [0, 0],
      [11, 40],
    ]) {
      const [x, y] = centerOf(row, col);
      const [ndcX, ndcY] = projectToNdc(cam, at(x, y, pose));
      const { origin, dir } = rayFromNdc(cam, ndcX, ndcY);
      const hit = raycast(mesh, positions, origin, dir);
      assert.ok(hit, `no hit for row ${row} col ${col} (tilt ${tilt})`);
      assert.deepEqual(cellAt(hit.x, hit.y, T), { row, col });
      assert.equal(caretOffset(ROWS, TEXT.length, row, col), ROWS[row].start + col);
    }
  }
});

test("cells on the curled corner itself are picked exactly", () => {
  const mesh = buildMesh();
  const pose = POSES["curl 0.5"];
  const positions = deformMesh(mesh, pose);
  // The roll's outer surface (the back of the paper) faces the corner, so the
  // printed, rising part of the curl is only visible looking into the roll
  // from the opposite (top-left) side.
  const cam = camera({ tilt: 55, yaw: -140, aspect: 0.8 });
  const [lx, ly] = curlLinePoint(pose.curl);
  let tested = 0;
  for (let row = 40; row < T.rows; row += 2) {
    for (let col = 50; col < T.cols; col += 3) {
      const [x, y] = centerOf(row, col);
      const s = (x - lx) * CURL_DIR[0] + (y - ly) * CURL_DIR[1];
      if (s < 6 || s > 20) continue; // on the rising part of the curl, still facing up
      const [ndcX, ndcY] = projectToNdc(cam, at(x, y, pose));
      const { origin, dir } = rayFromNdc(cam, ndcX, ndcY);
      const hit = raycast(mesh, positions, origin, dir);
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
  const positions = deformMesh(mesh, pose);
  const cam = camera({ tilt: 35, yaw: 10, aspect: 0.8 });
  const [lx, ly] = curlLinePoint(pose.curl);
  const [x, y] = [lx + CURL_DIR[0] * 12, ly + CURL_DIR[1] * 12];
  const [ndcX, ndcY] = projectToNdc(cam, at(x, y, pose));
  const { origin, dir } = rayFromNdc(cam, ndcX, ndcY);
  assert.equal(raycast(mesh, positions, origin, dir), null);
});

test("the back of a folded panel and the desk are not pickable", () => {
  const mesh = buildMesh();
  const pose = POSES["full letter fold"];
  const positions = deformMesh(mesh, pose);
  const cam = camera({ tilt: 0, yaw: 0, aspect: 0.8 });
  // Looking straight down at the folded letter shows the back of the top panel.
  const [ndcX, ndcY] = projectToNdc(cam, [0, 6, 0]);
  const down = rayFromNdc(cam, ndcX, ndcY);
  assert.equal(raycast(mesh, positions, down.origin, down.dir), null);
  // A ray toward the desk beside the sheet misses.
  const [dx, dy] = projectToNdc(cam, [PAPER_W, 0, 0]);
  const desk = rayFromNdc(cam, dx, dy);
  assert.equal(raycast(mesh, deformMesh(mesh, FLAT), desk.origin, desk.dir), null);
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
    assert.ok(Math.abs(p.foldBottom - prev.foldBottom) < 0.05 && Math.abs(p.foldTop - prev.foldTop) < 0.05, `jump at ${t}`);
    prev = p;
  }
});

test("camera zoom: an untilted sheet spans 210 × pxPerMm CSS px", async () => {
  const cssHeight = 800;
  const aspect = 1.2;
  const cssWidth = cssHeight * aspect;
  for (const pxPerMm of [2, 3.7795, 5]) {
    const cam = camera({ tilt: 0, yaw: 0, aspect, pxPerMm, cssHeight });
    const [l] = projectToNdc(cam, [-PAPER_W / 2, 0, 0]);
    const [r] = projectToNdc(cam, [PAPER_W / 2, 0, 0]);
    const widthPx = ((r - l) / 2) * cssWidth;
    assert.ok(Math.abs(widthPx - PAPER_W * pxPerMm) / (PAPER_W * pxPerMm) < 0.02, `${pxPerMm}: ${widthPx}`);
  }
});

test("print rows: page rows only, positioned on the grid", async () => {
  const { printRows } = await import("./texture.ts");
  const text = `${"x".repeat(170)}\n${Array.from({ length: 70 }, (_, i) => `line ${i}`).join("\n")}`;
  const rows = layoutRows(text, T.cols);
  const out = printRows(rows, text, T);
  assert.equal(out.length, T.rows);
  assert.deepEqual(out.slice(0, 3).map((r) => r.text.length), [80, 80, 10]);
  assert.ok(Math.abs(out[1].topMm - (T.marginY + T.cellH)) < 1e-9);
});
